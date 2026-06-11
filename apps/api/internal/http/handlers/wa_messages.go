package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	queuetasks "github.com/kriptonhaz/vintra/apps/api/internal/queue/tasks"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// WaMessages bundles message-related handlers — send, list. The send
// path enqueues to wa:send via asynq; actual delivery happens in the
// worker (queue/tasks/wa_send.go).
type WaMessages struct {
	q     *queries.Queries
	asynq *queue.Client
}

func NewWaMessages(q *queries.Queries, asynqClient *queue.Client) *WaMessages {
	return &WaMessages{q: q, asynq: asynqClient}
}

// ── Request / response DTOs ───────────────────────────────────────

type sendMessageReq struct {
	To   string `json:"to"`             // phone number, JID, or anything NormalizeJID can handle
	Type string `json:"type,omitempty"` // "text" (only kind in M2; future: image/document)
	Body string `json:"body"`
}

type messageResp struct {
	ID             string    `json:"id"`
	InstanceID     string    `json:"instanceId"`
	RemoteJid      string    `json:"remoteJid"`
	ExternalID     *string   `json:"externalId,omitempty"`
	FromMe         bool      `json:"fromMe"`
	Type           string    `json:"type"`
	Body           *string   `json:"body,omitempty"`
	Status         string    `json:"status"`
	ErrorMessage   *string   `json:"errorMessage,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	// Media (JUR-75). Present when Type is image / sticker / document.
	// hasMedia derived field: client checks `mediaKey != null`.
	MediaKey       *string   `json:"mediaKey,omitempty"`
	MediaMime      *string   `json:"mediaMime,omitempty"`
	MediaSizeBytes *int32    `json:"mediaSizeBytes,omitempty"`
	// Reactions (JUR-80). Inbound emoji reactions attached to this
	// message. Empty/omitted when no one has reacted.
	Reactions []reactionResp `json:"reactions,omitempty"`
}

// reactionResp is the per-bubble emoji pill the inbox renders.
// SenderJid lets the UI distinguish the customer's reaction from
// any echoed reaction we may have sent from another linked device.
type reactionResp struct {
	Emoji     string `json:"emoji"`
	SenderJid string `json:"senderJid"`
}

func toMessageResp(m queries.WaMessage) messageResp {
	resp := messageResp{
		ID:           db.UUIDString(m.ID),
		InstanceID:   db.UUIDString(m.InstanceID),
		RemoteJid:    m.RemoteJid,
		ExternalID:   textPtr(m.ExternalID),
		FromMe:       m.FromMe,
		Type:         m.Type,
		Body:         textPtr(m.Body),
		Status:       m.Status,
		ErrorMessage: textPtr(m.ErrorMessage),
		CreatedAt:    m.CreatedAt.Time,
		MediaKey:     textPtr(m.MediaKey),
		MediaMime:    textPtr(m.MediaMime),
	}
	if m.MediaSizeBytes.Valid {
		v := m.MediaSizeBytes.Int32
		resp.MediaSizeBytes = &v
	}
	return resp
}

// ── Handlers ──────────────────────────────────────────────────────

// Send POST /v1/wa/instances/:id/messages
//
// Two-step flow:
//   1. Insert wa_messages row in 'pending' status.
//   2. Enqueue wa:send task with the row id.
//
// The worker (queue/tasks/wa_send.go) handles delivery + retries. On
// success it flips the row to 'sent' with external_id populated; on
// final failure to 'failed' with error_message.
func (h *WaMessages) Send(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	instanceID, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	// Ownership check.
	if _, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: instanceID, TenantID: tenantID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	var req sendMessageReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	if req.To == "" {
		return badRequest(c, "to is required")
	}
	if req.Body == "" {
		return badRequest(c, "body is required")
	}
	if l := len(req.Body); l > 4000 {
		return badRequest(c, "body too long (max 4000 chars)")
	}
	if req.Type == "" {
		req.Type = "text"
	}
	if req.Type != "text" {
		// M2 is text-only. JUR-45 (media) lifts this.
		return badRequest(c, "only type=text supported for now")
	}

	jid, err := whatsapp.NormalizeJID(req.To)
	if err != nil {
		return badRequest(c, "invalid phone number: "+err.Error())
	}

	msg, err := h.q.CreateOutboundMessage(c.UserContext(), queries.CreateOutboundMessageParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
		RemoteJid:  jid,
		Type:       req.Type,
		Body:       pgtype.Text{String: req.Body, Valid: true},
	})
	if err != nil {
		return internalError(c, err)
	}

	// Upsert the contact projection so the chat UI shows this
	// recipient in its sidebar even before they reply. We don't
	// know their push_name yet — the upsert preserves any existing
	// name (e.g. set previously by an inbound message).
	_ = h.q.UpsertWaContactNoPushName(c.UserContext(), queries.UpsertWaContactNoPushNameParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
		RemoteJid:  jid,
	})

	payload, _ := json.Marshal(queuetasks.WASendPayload{MessageID: db.UUIDString(msg.ID)})
	task := asynq.NewTask(queue.TaskWASend, payload)

	// Use a slightly larger context than c.UserContext() — the
	// Fiber ctx is canceled when the request returns, which we WANT
	// for body reads but NOT for the enqueue (it talks to Redis and
	// we want it to complete even if the client hangs up).
	enqueueCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := h.asynq.EnqueueContext(enqueueCtx, task,
		asynq.Queue(queue.QueueWASend),
		asynq.MaxRetry(3),
		asynq.Timeout(30*time.Second),
	); err != nil {
		// Failed to enqueue — message is stuck in 'pending'. Mark it
		// failed inline so it doesn't sit forever.
		_ = h.q.MarkMessageFailed(enqueueCtx, queries.MarkMessageFailedParams{
			ID:           msg.ID,
			ErrorMessage: pgtype.Text{String: "enqueue failed: " + err.Error(), Valid: true},
		})
		return internalError(c, err)
	}

	return c.Status(fiber.StatusAccepted).JSON(toMessageResp(msg))
}

// List GET /v1/wa/instances/:id/messages?jid=...&limit=...
//
// Returns the conversation tail for the given (instance, jid) pair.
// Newest-first. Default limit 50, max 200.
func (h *WaMessages) List(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	instanceID, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	// Ownership check.
	if _, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: instanceID, TenantID: tenantID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	rawJid := c.Query("jid")
	if rawJid == "" {
		return badRequest(c, "jid query param is required")
	}
	jid, err := whatsapp.NormalizeJID(rawJid)
	if err != nil {
		return badRequest(c, "invalid jid: "+err.Error())
	}

	limit := int32(c.QueryInt("limit", 50))
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	rows, err := h.q.ListMessagesForConversation(c.UserContext(), queries.ListMessagesForConversationParams{
		InstanceID: instanceID,
		RemoteJid:  jid,
		Limit:      limit,
	})
	if err != nil {
		return internalError(c, err)
	}

	// JUR-80: fan-out fetch of reactions for the messages we're about
	// to render. One round trip via ANY($1::uuid[]) instead of N queries.
	// Empty result is fine — the pivot map just stays empty and bubbles
	// render without a pill.
	reactionsByParent := map[string][]reactionResp{}
	if len(rows) > 0 {
		ids := make([]pgtype.UUID, len(rows))
		for i, r := range rows {
			ids[i] = r.ID
		}
		reacts, err := h.q.ListReactionsForMessages(c.UserContext(), ids)
		if err != nil {
			return internalError(c, err)
		}
		for _, rx := range reacts {
			parent := db.UUIDString(rx.ParentMessageID)
			reactionsByParent[parent] = append(reactionsByParent[parent], reactionResp{
				Emoji:     rx.Emoji,
				SenderJid: rx.SenderJid,
			})
		}
	}

	out := make([]messageResp, len(rows))
	for i, r := range rows {
		m := toMessageResp(r)
		if rs, ok := reactionsByParent[m.ID]; ok {
			m.Reactions = rs
		}
		out[i] = m
	}
	return c.JSON(out)
}

// sendImageReq is the body for POST /v1/wa/instances/:id/messages/image.
// The web app uploads to S3 first via uploadWaMediaOutbound and posts
// only the resulting key here — small JSON payload, no multipart.
type sendImageReq struct {
	To       string `json:"to"`
	Caption  string `json:"caption"`
	S3Key    string `json:"s3Key"`
	Mime     string `json:"mime"`
	SizeBytes int32 `json:"sizeBytes"`
}

// SendImage POST /v1/wa/instances/:id/messages/image (JUR-76).
//
// Flow:
//  1. Validate s3Key starts with `{tenantId}/wa/{instanceId}/` so a
//     malicious caller can't reference another tenant's S3 object.
//  2. Insert wa_messages row (type='image', media_key set, status=pending).
//  3. Enqueue wa:send_image task with the row id.
func (h *WaMessages) SendImage(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)
	instanceID, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	if _, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: instanceID, TenantID: tenantID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	var req sendImageReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	if req.To == "" {
		return badRequest(c, "to is required")
	}
	if req.S3Key == "" {
		return badRequest(c, "s3Key is required")
	}
	if req.Mime == "" {
		return badRequest(c, "mime is required")
	}
	if l := len(req.Caption); l > 4000 {
		return badRequest(c, "caption too long (max 4000 chars)")
	}

	// Cross-tenant forgery defense: the key MUST start with the
	// caller's tenant + instance prefix. Without this, any
	// authenticated user could send the same uploaded image (anywhere
	// in the bucket) just by pointing s3Key at it.
	wantPrefix := tenantCtx.TenantID + "/wa/" + db.UUIDString(instanceID) + "/"
	if !strings.HasPrefix(req.S3Key, wantPrefix) {
		return badRequest(c, "s3Key tenant/instance prefix mismatch")
	}

	jid, err := whatsapp.NormalizeJID(req.To)
	if err != nil {
		return badRequest(c, "invalid phone number: "+err.Error())
	}

	body := pgtype.Text{Valid: false}
	if req.Caption != "" {
		body = pgtype.Text{String: req.Caption, Valid: true}
	}

	msg, err := h.q.CreateOutboundImageMessage(c.UserContext(), queries.CreateOutboundImageMessageParams{
		TenantID:       tenantID,
		InstanceID:     instanceID,
		RemoteJid:      jid,
		Body:           body,
		MediaKey:       pgtype.Text{String: req.S3Key, Valid: true},
		MediaMime:      pgtype.Text{String: req.Mime, Valid: true},
		MediaSizeBytes: pgtype.Int4{Int32: req.SizeBytes, Valid: req.SizeBytes > 0},
	})
	if err != nil {
		return internalError(c, err)
	}

	_ = h.q.UpsertWaContactNoPushName(c.UserContext(), queries.UpsertWaContactNoPushNameParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
		RemoteJid:  jid,
	})

	payload, _ := json.Marshal(queuetasks.WASendPayload{MessageID: db.UUIDString(msg.ID)})
	task := asynq.NewTask(queue.TaskWASendImage, payload)

	enqueueCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := h.asynq.EnqueueContext(enqueueCtx, task,
		asynq.Queue(queue.QueueWASend),
		asynq.MaxRetry(3),
		asynq.Timeout(60*time.Second), // longer than text — uploads + WA upload step
	); err != nil {
		_ = h.q.MarkMessageFailed(enqueueCtx, queries.MarkMessageFailedParams{
			ID:           msg.ID,
			ErrorMessage: pgtype.Text{String: "enqueue failed: " + err.Error(), Valid: true},
		})
		return internalError(c, err)
	}
	return c.Status(fiber.StatusAccepted).JSON(toMessageResp(msg))
}

// Get GET /v1/wa/messages/:id
//
// Tenant-scoped single-row fetch. The web app's getWaMediaUrl server
// fn (JUR-77) hits this to confirm a message belongs to the caller
// before signing an S3 URL. Includes media_key + media_mime in the
// payload so the server fn can sign in one round trip — body of the
// signed URL response then comes from S3 directly.
func (h *WaMessages) Get(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}
	id, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}

	msg, err := h.q.GetWaMessageByID(c.UserContext(), queries.GetWaMessageByIDParams{
		ID:       id,
		TenantID: tenantID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 404 covers both "doesn't exist" and "wrong tenant" — never
			// confirm to a probe that another tenant's id exists.
			return notFound(c)
		}
		return internalError(c, err)
	}

	resp := toMessageResp(msg)
	// Tenant id is included so the web fn can do a redundant equality
	// check; the API already enforced it via the WHERE clause.
	type withTenant struct {
		messageResp
		TenantID string `json:"tenantId"`
	}
	return c.JSON(withTenant{messageResp: resp, TenantID: tenantCtx.TenantID})
}
