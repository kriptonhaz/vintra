package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgtype"
	goredis "github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/storage"
)

// ErrInstanceNotConnected is returned by Get when there is no
// in-memory Connection for the given instance. Callers (HTTP
// handlers) typically map this to a 409 or trigger Start().
var ErrInstanceNotConnected = errors.New("instance not connected")

// Registry owns the in-memory map of active *Connection. Single
// replica only — sockets are stateful, owning the same socket from
// two replicas would break WhatsApp's session model. The eventual
// sharded multi-replica design lives in M5 (JUR-55).
//
// Storage layout: each instance gets its own SQLite file under
// storeRootDir at "{instanceID}.db". Multiple-device-per-store is
// possible but adds a lookup-by-JID indirection we don't need yet.
type Registry struct {
	mu          sync.RWMutex
	connections map[string]*instanceRecord

	q            *queries.Queries
	redis        *goredis.Client
	asynqClient  *asynq.Client
	storeRootDir string
	// s3 is optional. When nil (e.g., dev runs without AWS env vars),
	// inbound media is persisted with media_key=NULL and the UI shows
	// "Media tidak tersedia". Failing the boot would be too strict for
	// local dev; we log a warn instead so the gap is observable.
	s3 *storage.Client
}

// instanceRecord is what we keep per active instance — the
// Connection plus the Store that backs its session DB. Both get
// torn down together when the instance is Stop()'d.
type instanceRecord struct {
	conn  *Connection
	store *Store
}

// inboundDedupeTTL is the time a seen externalID lingers in the
// Redis SET. 5 minutes covers the typical whatsmeow resync window
// without bloating Redis with stale entries.
const inboundDedupeTTL = 5 * time.Minute

func NewRegistry(q *queries.Queries, redisClient *goredis.Client, asynqClient *asynq.Client, storeRootDir string, s3Client *storage.Client) *Registry {
	return &Registry{
		connections:  map[string]*instanceRecord{},
		q:            q,
		redis:        redisClient,
		asynqClient:  asynqClient,
		storeRootDir: storeRootDir,
		s3:           s3Client,
	}
}

// Start opens a Connection for the given instance. Idempotent —
// returns the existing Connection if one is already running.
//
// Tenant scoping is the CALLER's responsibility — Start does not
// look up wa_instances.tenant_id. HTTP handlers verify ownership
// via the standard q.GetWaInstance + tenant_id filter BEFORE
// calling Start.
func (r *Registry) Start(ctx context.Context, instanceID string) (*Connection, error) {
	// Fast path — already running.
	r.mu.RLock()
	if rec, ok := r.connections[instanceID]; ok {
		r.mu.RUnlock()
		return rec.conn, nil
	}
	r.mu.RUnlock()

	// Slow path — open the store, build + register the Connection.
	dbPath := filepath.Join(r.storeRootDir, instanceID+".db")
	store, err := NewStore(ctx, dbPath)
	if err != nil {
		return nil, fmt.Errorf("open store: %w", err)
	}

	// One device per store — get the first one or create fresh.
	device, err := store.Container.GetFirstDevice(ctx)
	if err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("get device: %w", err)
	}

	conn := NewConnection(instanceID, device)

	// Persist status changes back to wa_instances.
	conn.Subscribe(r.statusSubscriber(instanceID))

	// Dedupe + enqueue inbound messages. Fetch tenant_id once so the
	// worker payload is self-contained.
	tenantIDStr, err := r.lookupTenantID(ctx, instanceID)
	if err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("lookup tenant for instance %s: %w", instanceID, err)
	}
	conn.Subscribe(r.inboundSubscriber(conn, instanceID, tenantIDStr))

	if err := conn.Connect(ctx); err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("connect: %w", err)
	}

	// Double-check no one raced us into the map between fast path and
	// here. If they did, dispose the second connection and return the
	// winner.
	r.mu.Lock()
	if existing, ok := r.connections[instanceID]; ok {
		r.mu.Unlock()
		conn.Disconnect()
		_ = store.Close()
		return existing.conn, nil
	}
	r.connections[instanceID] = &instanceRecord{conn: conn, store: store}
	r.mu.Unlock()

	return conn, nil
}

// Purge disposes the in-memory Connection + Store AND deletes the
// per-instance SQLite session file. Use this when an instance is being
// permanently deleted (HTTP DELETE) — Stop alone leaves the .db file
// on disk, which keeps the device pairing data around forever.
//
// Idempotent: missing connection / missing file are not errors.
func (r *Registry) Purge(ctx context.Context, instanceID string) error {
	if err := r.Stop(ctx, instanceID); err != nil {
		// Stop closes the store cleanly; if it failed the SQLite file
		// is probably still locked. Continue anyway — best-effort.
		slog.Warn("registry.Purge: stop failed, continuing to file removal",
			"instance", instanceID, "err", err)
	}
	dbPath := filepath.Join(r.storeRootDir, instanceID+".db")
	for _, suffix := range []string{"", "-shm", "-wal"} {
		// SQLite WAL mode leaves -wal + -shm sidecar files. Remove all
		// three to fully reclaim disk and avoid an orphan device row
		// re-appearing if the api crashes mid-delete.
		path := dbPath + suffix
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove %s: %w", path, err)
		}
	}
	return nil
}

// Stop disposes the Connection + Store for the given instance.
// Idempotent — returns nil if no Connection was running.
func (r *Registry) Stop(ctx context.Context, instanceID string) error {
	r.mu.Lock()
	rec, ok := r.connections[instanceID]
	if !ok {
		r.mu.Unlock()
		return nil
	}
	delete(r.connections, instanceID)
	r.mu.Unlock()

	rec.conn.Disconnect()
	if err := rec.store.Close(); err != nil {
		return fmt.Errorf("close store: %w", err)
	}
	return nil
}

// Get returns the in-memory Connection for the instance, or
// ErrInstanceNotConnected if none is running. Used by the send path
// (JUR-67) which needs an active socket to send through.
func (r *Registry) Get(instanceID string) (*Connection, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rec, ok := r.connections[instanceID]
	if !ok {
		return nil, ErrInstanceNotConnected
	}
	return rec.conn, nil
}

// Status returns the current Connection status for the instance, or
// "disconnected" if no Connection is in memory.
func (r *Registry) Status(instanceID string) string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rec, ok := r.connections[instanceID]
	if !ok {
		return StatusDisconnected
	}
	return rec.conn.Status()
}

// ActiveCount returns how many wa_instances currently have an open
// whatsmeow socket in the registry. Used by /readyz so monitoring
// can alert if the api restarted but no tenants are reattached.
func (r *Registry) ActiveCount() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.connections)
}

// Revive is called once at boot. Queries wa_instances for rows whose
// last-persisted status suggests we should attempt to reattach
// ('connected' or 'connecting' — skip 'logged_out' / 'banned',
// those need explicit user action). Failures are logged but do not
// abort boot — partial revival is better than refusing to start.
func (r *Registry) Revive(ctx context.Context) {
	ids, err := r.q.ListWaInstancesForRevival(ctx)
	if err != nil {
		slog.Error("revive list failed", "err", err)
		return
	}
	if len(ids) == 0 {
		slog.Info("registry revive: no instances to attach")
		return
	}
	slog.Info("registry revive: starting instances", "count", len(ids))
	for _, id := range ids {
		idStr := db.UUIDString(id)
		if _, err := r.Start(ctx, idStr); err != nil {
			slog.Warn("revive failed for instance", "id", idStr, "err", err)
			continue
		}
	}
}

// Shutdown disconnects every active instance, closes all stores, and
// blocks until completion or ctx expires. Called from main.go on
// SIGTERM. After Shutdown the Registry is unusable — callers should
// not Start() again.
func (r *Registry) Shutdown(ctx context.Context) error {
	r.mu.Lock()
	records := make([]*instanceRecord, 0, len(r.connections))
	for id, rec := range r.connections {
		records = append(records, rec)
		delete(r.connections, id)
	}
	r.mu.Unlock()

	done := make(chan struct{})
	go func() {
		for _, rec := range records {
			rec.conn.Disconnect()
			_ = rec.store.Close()
		}
		close(done)
	}()

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("shutdown timed out: %w", ctx.Err())
	}
}

// lookupTenantID resolves the tenant_id for an instance via sqlc.
// Used by Start() to package the tenant_id into the inbound message
// payload so the wa:incoming worker doesn't need a second round-trip.
func (r *Registry) lookupTenantID(ctx context.Context, instanceID string) (string, error) {
	uid, err := db.ParseUUID(instanceID)
	if err != nil {
		return "", fmt.Errorf("parse instance id: %w", err)
	}
	tid, err := r.q.GetInstanceTenantID(ctx, uid)
	if err != nil {
		return "", err
	}
	return db.UUIDString(tid), nil
}

// ── Inbound subscriber ────────────────────────────────────────────

// InboundPayload is the JSON shape pushed into the wa:incoming task
// queue. Mirrors the worker's expected schema (queue/tasks/wa_incoming.go).
//
// FromMe distinguishes a true inbound (false) from a multi-device echo
// (true — message you sent from your phone or another linked device on
// the same WhatsApp account). Both go through the same queue so the
// dedupe path stays uniform; the worker branches on FromMe to decide
// which insert/upsert variant to call.
//
// RemoteJid is always the canonical phone-number JID
// (`@s.whatsapp.net`) when known — that's the form the chat UI binds
// to. LidJid is the privacy-mode LID for the same identity, persisted
// alongside so future messages addressed via LID can be resolved.
// Either one may be empty for a sender that's exposing only one form.
type InboundPayload struct {
	InstanceID string `json:"instanceId"`
	TenantID   string `json:"tenantId"`
	RemoteJid  string `json:"remoteJid"` // canonical PN form when available, else LID
	LidJid     string `json:"lidJid"`    // the LID form when distinct from RemoteJid
	ExternalID string `json:"externalId"`
	Body       string `json:"body"`
	Type       string `json:"type"`
	PushName   string `json:"pushName"`
	FromMe     bool   `json:"fromMe"`

	// Media (JUR-75). Populated when Type is "image" / "sticker" /
	// "document" AND the provider successfully downloaded + uploaded
	// to S3. All three are empty strings / 0 when there's no media OR
	// when download/upload failed (worker still persists the row so
	// chat history shows "Media tidak tersedia").
	MediaS3Key     string `json:"mediaS3Key,omitempty"`
	MediaMime      string `json:"mediaMime,omitempty"`
	MediaSizeBytes int64  `json:"mediaSizeBytes,omitempty"`
}

// ReactionPayload is the JSON shape pushed into the wa:reaction queue
// (JUR-80). The worker resolves ParentExternalID → parent_message_id
// against wa_messages (scoped by tenant + instance) and upserts/deletes
// based on Emoji ("" = removal).
type ReactionPayload struct {
	InstanceID       string `json:"instanceId"`
	TenantID         string `json:"tenantId"`
	ParentExternalID string `json:"parentExternalId"`
	SenderJid        string `json:"senderJid"`
	Emoji            string `json:"emoji"`
}

// LidBackfillPayload is the JSON shape for the wa:lid_backfill queue
// (JUR-93). The worker renames a LID-form wa_contacts row (and its
// linked wa_messages) to the newly-discovered PN form. Best-effort and
// idempotent — a worker that runs on already-renamed data simply
// returns 0 rows-affected and is fine.
type LidBackfillPayload struct {
	InstanceID string `json:"instanceId"`
	OldLid     string `json:"oldLid"`
	NewPn      string `json:"newPn"`
}

// pickPhoneAndLID inspects two JIDs whatsmeow may give us for the same
// identity (typically Info.Chat + Info.RecipientAlt for DMs) and
// returns the canonical phone-number JID and the LID-form JID, in that
// order. Either may be empty.
//
// WhatsApp's "Phone Number Privacy" rollout means every message
// carries both forms — one with `@s.whatsapp.net` (the phone number)
// and one with `@lid` (a privacy alias). Some legacy JIDs use
// `@s.whatsapp.net` with a 15-digit LID-style username; we treat those
// as LIDs too (any number > 14 digits in the username can't be E.164).
func pickPhoneAndLID(a, b types.JID) (pn, lid string) {
	classify := func(j types.JID) (jidStr string, isPN bool, isLID bool) {
		if j.IsEmpty() {
			return "", false, false
		}
		// ToNonAD strips the Agent + Device suffix so the stored JID is
		// the canonical user identifier — `628xxx@s.whatsapp.net`, NOT
		// `628xxx:2@s.whatsapp.net`. Device-suffixed JIDs are routing-
		// internal and rejected by whatsmeow.SendMessage with
		// "message recipient must be a user JID with no device part".
		// We see device suffixes whenever the inbound was sent from a
		// linked device (WhatsApp Web is device 2, iPad device 3, etc.).
		s := j.ToNonAD().String()
		if j.Server == types.HiddenUserServer { // @lid
			return s, false, true
		}
		if j.Server == types.DefaultUserServer { // @s.whatsapp.net
			// Real phone if the username is 8–14 digits — that's the
			// E.164 range. Longer = a LID disguised as a PN JID
			// (WhatsApp does this in some privacy paths).
			u := j.User
			if len(u) >= 8 && len(u) <= 14 && isAllDigits(u) {
				return s, true, false
			}
			return s, false, true // LID-style PN JID
		}
		return s, false, false
	}

	aStr, aIsPN, aIsLID := classify(a)
	bStr, bIsPN, bIsLID := classify(b)

	switch {
	case aIsPN:
		pn = aStr
	case bIsPN:
		pn = bStr
	}
	switch {
	case aIsLID:
		lid = aStr
	case bIsLID:
		lid = bStr
	}
	return pn, lid
}

func isAllDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return s != ""
}

// inboundSubscriber returns the Event handler that filters group /
// self / broadcast messages, de-dupes via Redis SADD, and enqueues
// surviving messages into the wa:incoming asynq queue.
//
// HOT PATH discipline: no DB writes. Redis SADD + asynq.Enqueue
// only. The worker does the heavy lifting (insert wa_messages,
// upsert wa_contacts).
func (r *Registry) inboundSubscriber(conn *Connection, instanceID, tenantID string) func(Event) {
	return func(e Event) {
		msgEvt, ok := e.(MessageEvent)
		if !ok || msgEvt.Raw == nil {
			return
		}
		info := msgEvt.Raw.Info

		// Group / broadcast / newsletter filter runs on the raw Chat
		// — those suffixes are never PN/LID alternations.
		chatStr := info.Chat.String()
		if chatStr == "status@broadcast" {
			return
		}
		if strings.HasSuffix(chatStr, "@g.us") {
			return
		}
		if strings.HasSuffix(chatStr, "@newsletter") {
			return
		}

		// Self-message filter — "Message yourself" / Notes feature +
		// the internal history-sync chatter whatsmeow emits during
		// initial pair. Detected by fromMe AND Chat.User ==
		// Sender.User on the same JID. We don't want the paired
		// number polluting the customer chat list as a contact.
		if info.IsFromMe && info.Chat.User == info.Sender.User {
			slog.Debug("inbound skipped (self-message)",
				"instance", instanceID,
				"chat", chatStr,
				"externalId", info.ID,
			)
			return
		}

		// Pick the canonical phone JID for storage.
		//
		// whatsmeow attaches an "alternate" form of every JID to a DM
		// — but WHICH JID gets an alternate depends on the direction:
		//
		//   - Inbound (fromMe=false): Sender is the other party; its
		//     alt lives in SenderAlt. RecipientAlt is *our own* alt.
		//   - Outbound echo (fromMe=true): Recipient is the other
		//     party; its alt lives in RecipientAlt. SenderAlt is our
		//     own alt.
		//
		// Either way, `Chat` is always the other party's JID. We pair
		// it with whichever alt-field refers to "the other party" too,
		// so pickPhoneAndLID can pick the PN form over the LID form.
		var otherPartyAlt types.JID
		if info.IsFromMe {
			otherPartyAlt = info.RecipientAlt
		} else {
			otherPartyAlt = info.SenderAlt
		}
		pnJid, lidJid := pickPhoneAndLID(info.Chat, otherPartyAlt)

		// JUR-93: opportunistic LID→PN resolution. If the current event
		// arrived with only the LID (privacy-on customer, no SenderAlt
		// inline), consult whatsmeow's local LID store — the mapping is
		// often already cached from an earlier event that did include
		// the PN. When the lookup succeeds we ALSO enqueue a backfill
		// task so old wa_contacts/wa_messages rows that were stored
		// under the LID get renamed to the PN. Best-effort: any error
		// here logs and falls back to the LID form.
		var lidBackfillFrom, lidBackfillTo string
		if pnJid == "" && lidJid != "" {
			lookupCtx, lookupCancel := context.WithTimeout(context.Background(), 2*time.Second)
			cachedPn, err := conn.Client.Store.LIDs.GetPNForLID(lookupCtx, info.Chat)
			lookupCancel()
			if err != nil {
				slog.Debug("LID→PN lookup failed",
					"instance", instanceID, "lid", lidJid, "err", err)
			} else if !cachedPn.IsEmpty() {
				resolvedPn := cachedPn.ToNonAD().String()
				slog.Info("LID→PN resolved via local store",
					"instance", instanceID, "lid", lidJid, "pn", resolvedPn)
				pnJid = resolvedPn
				lidBackfillFrom = lidJid
				lidBackfillTo = resolvedPn
			}
		}

		var remoteJid string
		switch {
		case pnJid != "":
			remoteJid = pnJid
		case lidJid != "":
			remoteJid = lidJid
		default:
			remoteJid = chatStr // very rare, but don't drop on the floor
		}

		// JUR-93: enqueue the backfill BEFORE the wa:incoming task so
		// the worker pool sees them in dispatch order. Both workers run
		// against the same DB, but wa:lid_backfill is concurrency 1
		// (no contention with itself) and idempotent — re-running on
		// already-renamed data is a no-op. We don't block on enqueue
		// failure; the next inbound from the same contact will retry.
		if lidBackfillFrom != "" && lidBackfillTo != "" && lidBackfillFrom != lidBackfillTo {
			bp := LidBackfillPayload{
				InstanceID: instanceID,
				OldLid:     lidBackfillFrom,
				NewPn:      lidBackfillTo,
			}
			if bpBytes, err := json.Marshal(bp); err == nil {
				bctx, bcancel := context.WithTimeout(context.Background(), 2*time.Second)
				task := asynq.NewTask("wa:lid_backfill", bpBytes)
				if _, err := r.asynqClient.EnqueueContext(bctx, task,
					asynq.Queue("wa:lid_backfill"),
					asynq.MaxRetry(3),
					asynq.Timeout(30*time.Second),
				); err != nil {
					slog.Warn("lid_backfill enqueue failed",
						"instance", instanceID, "lid", lidBackfillFrom, "pn", lidBackfillTo, "err", err)
				}
				bcancel()
			}
		}

		// One terse line per inbound event so the path is observable
		// end-to-end without a debugger. Filtered events log at debug
		// (so prod stays quiet); enqueued ones log at info.
		slog.Debug("inbound event received",
			"instance", instanceID,
			"remoteJid", remoteJid,
			"lidJid", lidJid,
			"chat", chatStr,
			"sender", info.Sender.String(),
			"senderAlt", info.SenderAlt.String(),
			"recipientAlt", info.RecipientAlt.String(),
			"fromMe", info.IsFromMe,
			"externalId", info.ID,
		)

		// JUR-80: capture reactions instead of dropping them. Enqueue a
		// dedicated wa:reaction task carrying the parent's external ID
		// + emoji + sender JID; the worker resolves the parent's UUID
		// and upserts/deletes. Returning early skips the rest of the
		// inbound pipeline (dedupe / media download / wa:incoming task)
		// — reactions don't belong in those flows.
		if reactMsg := msgEvt.Raw.Message.GetReactionMessage(); reactMsg != nil {
			parentExt := reactMsg.GetKey().GetID()
			if parentExt == "" {
				slog.Debug("reaction with empty parent id, skipping",
					"instance", instanceID, "jid", remoteJid)
				return
			}
			payload := ReactionPayload{
				InstanceID:       instanceID,
				TenantID:         tenantID,
				ParentExternalID: parentExt,
				SenderJid:        info.Sender.ToNonAD().String(),
				Emoji:            reactMsg.GetText(),
			}
			bytes, err := json.Marshal(payload)
			if err != nil {
				slog.Error("reaction marshal failed", "instance", instanceID, "err", err)
				return
			}
			rctx, rcancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer rcancel()
			task := asynq.NewTask("wa:reaction", bytes)
			if _, err := r.asynqClient.EnqueueContext(rctx, task,
				asynq.Queue("wa:reaction"),
				asynq.MaxRetry(3),
				asynq.Timeout(15*time.Second),
			); err != nil {
				slog.Error("reaction enqueue failed", "instance", instanceID, "err", err)
				return
			}
			slog.Info("reaction enqueued",
				"instance", instanceID,
				"jid", remoteJid,
				"parent", parentExt,
				"emoji", reactMsg.GetText(),
			)
			return
		}

		// Drop protocol messages / encryption bootstrap before we hit
		// dedupe — these aren't real "messages" from the operator's
		// perspective and would otherwise show as "[Pesan tidak didukung]"
		// bubbles in the chat detail.
		if isSkippableMessage(msgEvt.Raw) {
			slog.Debug("inbound skipped (protocol)",
				"instance", instanceID,
				"jid", remoteJid,
				"externalId", info.ID,
			)
			return
		}

		externalID := info.ID
		if externalID == "" {
			slog.Warn("inbound msg with empty external id", "instance", instanceID, "jid", remoteJid)
			return
		}

		// Dedupe via Redis SET. SADD returns 1 if added (new), 0 if
		// already member. Refresh the TTL each time so the window
		// rolls forward with traffic.
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		dedupeKey := "wa:seen:" + instanceID
		added, err := r.redis.SAdd(ctx, dedupeKey, externalID).Result()
		if err != nil {
			slog.Error("inbound dedupe sadd failed", "instance", instanceID, "err", err)
			// Fail OPEN — still enqueue. Better to insert a duplicate
			// (worker's ON CONFLICT DO NOTHING catches it) than to
			// drop a real customer message because Redis was down.
		} else if added == 0 {
			// Already seen during the current window.
			return
		}
		// Best-effort TTL bump. If this fails entries linger but
		// don't grow unbounded — they're cleared on the next SAdd
		// + EXPIRE.
		r.redis.Expire(ctx, dedupeKey, inboundDedupeTTL)

		// Extract body + type. Media messages also expose the
		// downloadable handle + mime so we can persist the bytes
		// to S3 (JUR-75).
		body, mtype, dl, mime := extractMessageContent(msgEvt.Raw)

		// Media path: synchronously download + upload to S3. Stays on
		// this goroutine (already inside safego.RecoverFn from
		// provider.AddEventHandler) so a panic doesn't escape. We accept
		// the latency hit (few hundred ms per image) because:
		//   - the next inbound is independently dispatched by whatsmeow,
		//   - skipping the upload would mean lost media bytes,
		//   - asynq enqueue downstream still runs in <50ms even with
		//     this work in-band.
		// Failure (network blip, S3 outage) is logged and the message
		// row still gets persisted with empty MediaS3Key so chat
		// history isn't truncated. We don't retry — whatsmeow won't
		// re-emit the event.
		var mediaKey, mediaMime string
		var mediaSize int64
		if dl != nil && r.s3 != nil {
			downloadCtx, cancelDL := context.WithTimeout(context.Background(), 15*time.Second)
			data, err := conn.Client.Download(downloadCtx, dl)
			cancelDL()
			if err != nil {
				slog.Warn("inbound media download failed",
					"instance", instanceID, "type", mtype, "err", err)
			} else {
				ext := storage.MimeToExt(mime)
				// Key includes externalID (whatsmeow's stable ID) so
				// idempotent retries don't double-upload. The worker's
				// dedupe path means we'd never call this twice for the
				// same message in practice, but keys are tied to message
				// identity for cleanliness.
				mediaKey = fmt.Sprintf("%s/wa/%s/%s%s", tenantID, instanceID, externalID, ext)
				upCtx, cancelUp := context.WithTimeout(context.Background(), 15*time.Second)
				err := r.s3.Upload(upCtx, mediaKey, data, mime, "kind=wa-media")
				cancelUp()
				if err != nil {
					slog.Warn("inbound media s3 upload failed",
						"instance", instanceID, "key", mediaKey, "err", err)
					mediaKey = "" // drop on failure
				} else {
					mediaMime = mime
					mediaSize = int64(len(data))
				}
			}
		} else if dl != nil && r.s3 == nil {
			slog.Warn("inbound media skipped — no S3 client configured",
				"instance", instanceID, "type", mtype)
		}

		payload := InboundPayload{
			InstanceID:     instanceID,
			TenantID:       tenantID,
			RemoteJid:      remoteJid,
			LidJid:         lidJid,
			ExternalID:     externalID,
			Body:           body,
			Type:           mtype,
			PushName:       info.PushName,
			FromMe:         info.IsFromMe,
			MediaS3Key:     mediaKey,
			MediaMime:      mediaMime,
			MediaSizeBytes: mediaSize,
		}
		bytes, err := json.Marshal(payload)
		if err != nil {
			slog.Error("inbound marshal failed", "instance", instanceID, "err", err)
			return
		}

		task := asynq.NewTask("wa:incoming", bytes)
		if _, err := r.asynqClient.EnqueueContext(ctx, task,
			asynq.Queue("wa:incoming"),
			asynq.MaxRetry(3),
			asynq.Timeout(30*time.Second),
		); err != nil {
			slog.Error("inbound enqueue failed", "instance", instanceID, "err", err)
			return
		}
		slog.Info("inbound enqueued",
			"instance", instanceID,
			"remoteJid", remoteJid,
			"lidJid", lidJid,
			"type", mtype,
			"externalId", externalID,
		)
	}
}

// isSkippableMessage returns true for inbound message types that
// shouldn't appear in the chat log: reactions (👍 ❤️), edits, deletions,
// view-once notifications, polls etc. They're not "real" messages from
// the operator's perspective — surfacing them as "[Pesan tidak
// didukung]" bubbles just adds noise.
//
// Reactions especially: WhatsApp delivers them as separate inbound
// events keyed to the parent message. We don't model reactions yet
// (would need a wa_reactions table linking back to the parent), so for
// v1 we just swallow them.
func isSkippableMessage(msg *events.Message) bool {
	m := msg.Message
	if m == nil {
		return false
	}
	if m.GetReactionMessage() != nil {
		return true
	}
	if m.GetProtocolMessage() != nil {
		// ProtocolMessage covers edits, revoke (delete-for-everyone),
		// disappearing-mode toggles, ephemeral settings, etc.
		return true
	}
	if m.GetSenderKeyDistributionMessage() != nil {
		// Group key bootstrap — internal protocol chatter we already
		// filter at the group-JID layer; defensive check here too.
		return true
	}
	return false
}

// extractMessageContent returns the visible body text + content type
// for an inbound message. For media types (image / sticker / document
// / video / audio) it ALSO returns the downloadable handle and mime
// so the caller can fetch the bytes via whatsmeow.Client.Download.
//
// `dl` is nil for text-only messages.
func extractMessageContent(msg *events.Message) (body, mtype string, dl whatsmeow.DownloadableMessage, mime string) {
	m := msg.Message
	if m == nil {
		return "", "unknown", nil, ""
	}
	if t := m.GetConversation(); t != "" {
		return t, "text", nil, ""
	}
	if ext := m.GetExtendedTextMessage(); ext != nil {
		return ext.GetText(), "text", nil, ""
	}
	if im := m.GetImageMessage(); im != nil {
		return im.GetCaption(), "image", im, im.GetMimetype()
	}
	if vm := m.GetVideoMessage(); vm != nil {
		// Video isn't rendered in v1 but we still upload to S3 so the
		// admin can download it manually if curious. Treated like image.
		return vm.GetCaption(), "video", vm, vm.GetMimetype()
	}
	if dm := m.GetDocumentMessage(); dm != nil {
		return dm.GetCaption(), "document", dm, dm.GetMimetype()
	}
	if am := m.GetAudioMessage(); am != nil {
		// Audio voice notes — not rendered in v1, but we don't drop them.
		return "", "audio", am, am.GetMimetype()
	}
	if sm := m.GetStickerMessage(); sm != nil {
		return "", "sticker", sm, sm.GetMimetype()
	}
	return "", "other", nil, ""
}

// ── Status subscriber ─────────────────────────────────────────────

// statusSubscriber returns the event handler that maps typed events
// back into wa_instances.status writes. One per instance, attached
// during Start().
//
// Fire-and-forget DB writes (background ctx, 5s timeout) — the
// Connection's event handler runs on a hot path and we don't want
// to block on slow Supabase round-trips.
func (r *Registry) statusSubscriber(instanceID string) func(Event) {
	uid, err := db.ParseUUID(instanceID)
	if err != nil {
		// instanceID came from a wa_instances row, so it's always a
		// valid UUID. If we get here something's deeply wrong — log
		// and return a no-op subscriber.
		slog.Error("status subscriber: bad instance id", "id", instanceID, "err", err)
		return func(Event) {}
	}

	return func(e Event) {
		var status string
		var reason pgtype.Text
		var phone pgtype.Text

		switch ev := e.(type) {
		case ConnectedEvent:
			status = StatusConnected
			// Backfill wa_instances.phone_number on every connect. Empty
			// on pre-pair transient events; COALESCE in SQL keeps the
			// existing value in that case so we never wipe a known phone.
			if ev.PhoneNumber != "" {
				phone = pgtype.Text{String: ev.PhoneNumber, Valid: true}
			}
		case DisconnectedEvent:
			// We're auto-retrying — DB status should reflect "connecting".
			status = StatusConnecting
			if ev.Err != nil {
				reason = pgtype.Text{String: ev.Err.Error(), Valid: true}
			}
		case GiveUpEvent:
			status = StatusDisconnected
		case LoggedOutEvent:
			status = StatusLoggedOut
		default:
			return
		}

		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			err := r.q.UpdateWaInstanceStatus(ctx, queries.UpdateWaInstanceStatusParams{
				ID:                   uid,
				Status:               status,
				LastDisconnectReason: reason,
				PhoneNumber:          phone,
			})
			if err != nil {
				slog.Error("status update failed", "instance", instanceID, "status", status, "err", err)
			}
		}()
	}
}
