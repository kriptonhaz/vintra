package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"github.com/kriptonhaz/vintra/apps/api/internal/safego"
)

// Status values mirror the wa_instances.status column. Registry
// consumes these and writes them back to Postgres.
const (
	StatusDisconnected = "disconnected"
	StatusQR           = "qr"
	StatusConnecting   = "connecting"
	StatusConnected    = "connected"
	StatusLoggedOut    = "logged_out"
)

// Connection wraps a single whatsmeow.Client + the Subscribe/emit
// fanout to typed Event subscribers + the reconnect policy (JUR-65).
//
// Lifecycle:
//
//	construct → Connect(ctx) → [use SendText, receive events] → Disconnect()
//
// Single instance per WhatsApp account. The registry (JUR-66) owns a
// map[instanceID]*Connection and never shares one across goroutines'
// owning operations — only multiple subscribers (read-only) attach.
type Connection struct {
	InstanceID string
	Device     *store.Device
	Client     *whatsmeow.Client

	mu          sync.RWMutex
	status      string
	listeners   []func(Event)
	listenersMu sync.RWMutex
	pairMu      sync.Mutex

	// Reconnect state — guarded by reconnectMu. Read only inside the
	// guarded sections of scheduleReconnect / Disconnect / Connected
	// event handler.
	reconnectMu      sync.Mutex
	reconnectAttempt int
	reconnectTimer   *time.Timer
	closed           bool // true once Disconnect() called; prevents accidental retry
}

// NewConnection builds a wrapper around an existing Device. The
// caller (registry) is responsible for fetching/creating the Device
// from the shared sqlstore Container.
//
// whatsmeow's built-in auto-reconnect is disabled — we own the retry
// policy (exp backoff with jitter + give-up after MaxReconnectAttempts,
// see disconnect.go) so we can surface GiveUpEvent and stop hammering
// after sustained failures.
func NewConnection(instanceID string, device *store.Device) *Connection {
	client := whatsmeow.NewClient(device, newWALogger("whatsmeow-"+instanceID, slog.LevelWarn))
	client.EnableAutoReconnect = false
	c := &Connection{
		InstanceID: instanceID,
		Device:     device,
		Client:     client,
		status:     StatusDisconnected,
	}
	// Wrap with safego so a panic inside event parsing (nil-pointer in a
	// malformed WhatsApp protocol message, type assertion blowup, etc.)
	// doesn't crash the entire api process and force every tenant to
	// rescan their QR code. Recovery logs the panic with a stack trace
	// and continues — the next event still processes normally.
	client.AddEventHandler(safego.RecoverFn("wa.event_handler", c.handleWAEvent))
	return c
}

// Connect opens the socket. If the device has no stored credentials
// (first-time pairing), spawns a goroutine that pulls QR codes from
// whatsmeow's QR channel and emits them as QREvents. If the device
// IS paired, just resumes — no QR needed.
//
// Returns once the socket is dialed (which is fast — actual pairing
// completion comes later via ConnectedEvent).
func (c *Connection) Connect(ctx context.Context) error {
	c.setStatus(StatusConnecting)

	if c.Client.Store.ID == nil {
		// Fresh device — needs pairing via QR.
		qrChan, err := c.Client.GetQRChannel(ctx)
		if err != nil {
			c.setStatus(StatusDisconnected)
			return fmt.Errorf("get qr channel: %w", err)
		}
		if err := c.Client.Connect(); err != nil {
			c.setStatus(StatusDisconnected)
			return fmt.Errorf("client connect: %w", err)
		}
		go c.handleQRChan(qrChan)
		return nil
	}

	// Pre-paired device — credentials live in SQLite. Just resume.
	if err := c.Client.Connect(); err != nil {
		c.setStatus(StatusDisconnected)
		return fmt.Errorf("client connect: %w", err)
	}
	return nil
}

// PairPhone asks WhatsApp for a short phone-linking code. The client must
// already be connected in first-time pairing mode; callers should wait until
// the QR flow has emitted at least one QR event before calling this.
func (c *Connection) PairPhone(ctx context.Context, phone string) (string, error) {
	c.pairMu.Lock()
	defer c.pairMu.Unlock()

	return c.Client.PairPhone(
		ctx,
		phone,
		true,
		whatsmeow.PairClientChrome,
		"Chrome (Linux)",
	)
}

// Disconnect closes the socket and removes all subscribers. Idempotent.
// Should be called by the registry on Shutdown or when the instance
// is explicitly stopped.
//
// Sets the `closed` flag first so the in-flight reconnect timer (if
// any) won't spawn another Connect attempt after we've torn down.
func (c *Connection) Disconnect() {
	c.reconnectMu.Lock()
	c.closed = true
	if c.reconnectTimer != nil {
		c.reconnectTimer.Stop()
		c.reconnectTimer = nil
	}
	c.reconnectMu.Unlock()

	c.Client.Disconnect()
	c.setStatus(StatusDisconnected)
	c.listenersMu.Lock()
	c.listeners = nil
	c.listenersMu.Unlock()
}

// scheduleReconnect bumps the attempt counter, schedules a timer at
// NextDelay(attempt), and on fire calls Client.Connect(). If Connect
// fails immediately, recurses (which respects MaxReconnectAttempts).
//
// Called from the *events.Disconnected handler. Returns early if the
// Connection was explicitly closed via Disconnect() — we don't want
// to fight a clean shutdown by re-opening sockets.
func (c *Connection) scheduleReconnect() {
	c.reconnectMu.Lock()
	if c.closed {
		c.reconnectMu.Unlock()
		return
	}
	if c.reconnectAttempt >= MaxReconnectAttempts {
		c.reconnectMu.Unlock()
		c.setStatus(StatusDisconnected)
		c.emit(GiveUpEvent{})
		return
	}
	delay := NextDelay(c.reconnectAttempt)
	c.reconnectAttempt++
	c.setStatus(StatusConnecting)
	c.reconnectTimer = time.AfterFunc(delay, c.runReconnect)
	c.reconnectMu.Unlock()

	slog.Info("scheduled reconnect",
		"instance", c.InstanceID,
		"attempt", c.reconnectAttempt,
		"delay", delay)
}

// runReconnect fires from the timer. Tries to dial — if that errors,
// schedules another attempt (the *events.Disconnected fallback won't
// fire because the dial never opened a session).
func (c *Connection) runReconnect() {
	// Re-check closed under the lock — Disconnect() may have set it
	// between scheduling and firing.
	c.reconnectMu.Lock()
	closed := c.closed
	c.reconnectMu.Unlock()
	if closed {
		return
	}

	if err := c.Client.Connect(); err != nil {
		slog.Warn("reconnect attempt failed",
			"instance", c.InstanceID,
			"err", err)
		c.scheduleReconnect()
		return
	}
	// On success the *events.Connected handler resets the counter +
	// emits ConnectedEvent. Nothing else to do here.
}

// Status returns the current Connection status. Race-safe.
func (c *Connection) Status() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.status
}

func (c *Connection) setStatus(s string) {
	c.mu.Lock()
	c.status = s
	c.mu.Unlock()
}

// Subscribe registers a handler for typed events. Handlers run
// synchronously in the order they were added — keep them fast (no DB
// calls, no I/O). The inbound worker queues via asynq from inside its
// handler, which is the right pattern.
func (c *Connection) Subscribe(handler func(Event)) {
	c.listenersMu.Lock()
	defer c.listenersMu.Unlock()
	c.listeners = append(c.listeners, handler)
}

func (c *Connection) emit(e Event) {
	c.listenersMu.RLock()
	snapshot := make([]func(Event), len(c.listeners))
	copy(snapshot, c.listeners)
	c.listenersMu.RUnlock()
	for _, h := range snapshot {
		h(e)
	}
}

// SendText sends a plain-text message to the given JID. Returns the
// whatsmeow message id (which we persist as wa_messages.external_id
// for dedupe).
func (c *Connection) SendText(ctx context.Context, jid types.JID, body string) (string, error) {
	resp, err := c.Client.SendMessage(ctx, jid, &waProto.Message{
		Conversation: proto.String(body),
	})
	if err != nil {
		return "", fmt.Errorf("whatsmeow send: %w", err)
	}
	return resp.ID, nil
}

// SendImage uploads `data` to WhatsApp's media servers (encrypted), then
// sends an ImageMessage to `jid` with optional `caption`. Returns the
// whatsmeow message id like SendText.
//
// `mime` should be the source image's MIME ("image/jpeg" / "image/png" /
// "image/webp") — WhatsApp embeds it so the recipient's app picks the
// right viewer. Whatsmeow doesn't transcode; what we upload is what
// the recipient sees.
func (c *Connection) SendImage(ctx context.Context, jid types.JID, data []byte, mime, caption string) (string, error) {
	uploaded, err := c.Client.Upload(ctx, data, whatsmeow.MediaImage)
	if err != nil {
		return "", fmt.Errorf("whatsmeow upload: %w", err)
	}
	msg := &waProto.Message{
		ImageMessage: &waProto.ImageMessage{
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mime),
			URL:           proto.String(uploaded.URL),
			DirectPath:    proto.String(uploaded.DirectPath),
			MediaKey:      uploaded.MediaKey,
			FileEncSHA256: uploaded.FileEncSHA256,
			FileSHA256:    uploaded.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(data))),
		},
	}
	resp, err := c.Client.SendMessage(ctx, jid, msg)
	if err != nil {
		return "", fmt.Errorf("whatsmeow send: %w", err)
	}
	return resp.ID, nil
}

// ── whatsmeow event handler ───────────────────────────────────────

// handleWAEvent is registered with whatsmeow's event bus. Translates
// the raw whatsmeow event vocabulary into our narrower typed events.
//
// HOT PATH — never do DB calls here. Subscribers that need to persist
// should enqueue and return.
func (c *Connection) handleWAEvent(rawEvt interface{}) {
	switch e := rawEvt.(type) {
	case *events.Connected:
		// Reset the reconnect counter — we recovered, the next blip
		// starts from attempt=0 again.
		c.reconnectMu.Lock()
		c.reconnectAttempt = 0
		c.reconnectMu.Unlock()

		c.setStatus(StatusConnected)
		// Capture the paired phone number for the wa_instances.phone_number
		// column. Store.ID is nil before the first successful pairing —
		// in that pre-pair edge case we emit an empty PhoneNumber and the
		// subscriber's COALESCE leaves the column alone.
		var paired string
		if c.Client != nil && c.Client.Store != nil && c.Client.Store.ID != nil {
			paired = c.Client.Store.ID.User
		}
		c.emit(ConnectedEvent{PhoneNumber: paired})

	case *events.LoggedOut:
		c.setStatus(StatusLoggedOut)
		c.emit(LoggedOutEvent{})

	case *events.Disconnected:
		// "Disconnected" in whatsmeow's vocabulary means an unrequested
		// close — network blip, server restart, etc. Surface the event
		// so the registry can flip wa_instances.status to 'connecting',
		// then schedule the next attempt.
		c.emit(DisconnectedEvent{Err: nil})
		c.scheduleReconnect()

	case *events.StreamReplaced:
		// Another device started a session — equivalent to logout
		// from our side (we lose pairing).
		c.setStatus(StatusLoggedOut)
		c.emit(LoggedOutEvent{})

	case *events.Message:
		c.emit(MessageEvent{Raw: e})

	// Other events (Receipt, Presence, ChatPresence, etc.) we ignore
	// for now — adding handlers is cheap if a feature needs them.
	default:
		// no-op
	}
}

// ── QR channel handler ────────────────────────────────────────────

// handleQRChan runs in its own goroutine while whatsmeow's QR
// channel is open. Each "code" item is rendered as a PNG data URL
// and pushed to subscribers as a QREvent.
func (c *Connection) handleQRChan(ch <-chan whatsmeow.QRChannelItem) {
	for evt := range ch {
		switch evt.Event {
		case "code":
			c.setStatus(StatusQR)
			dataURL, err := renderQR(evt.Code)
			if err != nil {
				slog.Error("qr render failed", "instance", c.InstanceID, "err", err)
				continue
			}
			c.emit(QREvent{Code: evt.Code, DataURL: dataURL})

		case "timeout":
			c.setStatus(StatusDisconnected)
			c.emit(DisconnectedEvent{Err: errors.New("qr timeout")})

		case "success":
			// Pairing complete; ConnectedEvent will fire via the
			// whatsmeow event handler next.

		case "err-client-outdated":
			c.setStatus(StatusLoggedOut)
			c.emit(LoggedOutEvent{})
			return

		default:
			// Unknown QR event — log and continue. Future whatsmeow
			// versions may add new event types here.
			slog.Warn("unknown qr channel event", "instance", c.InstanceID, "event", evt.Event)
		}
	}
}
