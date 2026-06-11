package whatsapp

import "go.mau.fi/whatsmeow/types/events"

// Event is the typed sum we emit to subscribers. Each variant is a
// distinct struct so the registry's switch can pattern-match on it.
//
// Why not just forward whatsmeow's raw events? Two reasons:
//   1. Our subscribers (registry, inbound worker, AI worker) don't need
//      the full whatsmeow event vocabulary — only ~5 kinds. The narrow
//      surface is easier to mock in tests.
//   2. The QR event needs a rendered PNG data URL, not the raw pairing
//      string — we transform that BEFORE emitting so subscribers don't
//      have to know about QR rendering.
type Event interface{ isWhatsappEvent() }

// QREvent fires when whatsmeow's QR channel emits a "code" item.
// The Code is the raw pairing payload (string like "2@..."); DataURL
// is a `data:image/png;base64,...` representation suitable for an
// <img> tag. Subscribers (registry → HTTP handler → web UI) typically
// only use DataURL.
type QREvent struct {
	Code    string
	DataURL string
}

func (QREvent) isWhatsappEvent() {}

// ConnectedEvent fires after a successful socket open (whether first
// pairing or a restart-revive). Registry uses it to flip wa_instances
// status to 'connected' and to resolve any pending /connect HTTP
// requests.
//
// PhoneNumber carries the paired account's E.164 digits (e.g.
// "628118492869") pulled from whatsmeow's Store.ID.User. Empty when
// the client isn't yet paired (transient pre-pair connect events).
// The registry's status subscriber writes this back to
// wa_instances.phone_number on every ConnectedEvent so the column
// stays accurate across re-pairs.
type ConnectedEvent struct {
	PhoneNumber string
}

func (ConnectedEvent) isWhatsappEvent() {}

// DisconnectedEvent fires for any non-logout drop (network blip,
// server-side restart, etc.). The reconnect policy in JUR-65 inspects
// this and decides whether to retry. Err is the underlying whatsmeow
// disconnect error if available.
type DisconnectedEvent struct {
	Err error
}

func (DisconnectedEvent) isWhatsappEvent() {}

// LoggedOutEvent fires when the user explicitly unlinked the device
// from WhatsApp (or got banned). Registry must NOT reconnect — the
// session is permanently dead until the user pairs again.
type LoggedOutEvent struct{}

func (LoggedOutEvent) isWhatsappEvent() {}

// GiveUpEvent fires after the reconnect policy in JUR-65 exhausts its
// attempts. Different from LoggedOut: this is "we tried 8 times and
// the network is still dead, mark as disconnected and let a human
// retry".
type GiveUpEvent struct{}

func (GiveUpEvent) isWhatsappEvent() {}

// MessageEvent forwards a raw whatsmeow message. The inbound worker
// (JUR-68) filters groups/self/broadcasts, deduplicates via Redis,
// then enqueues for persistence.
type MessageEvent struct {
	Raw *events.Message
}

func (MessageEvent) isWhatsappEvent() {}
