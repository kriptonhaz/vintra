package handlers

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
	"github.com/kriptonhaz/vintra/apps/api/internal/storage"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// WaInstances bundles the wa_instances CRUD handlers. Constructed
// once in http.NewServer and registered as routes from there.
//
// registry + s3 are optional (nil-safe in Delete) so unit tests can
// exercise CRUD without spinning whatsmeow / AWS.
type WaInstances struct {
	q        *queries.Queries
	registry *whatsapp.Registry
	s3       *storage.Client
}

func NewWaInstances(q *queries.Queries, registry *whatsapp.Registry, s3 *storage.Client) *WaInstances {
	return &WaInstances{q: q, registry: registry, s3: s3}
}

// ── DTOs ──────────────────────────────────────────────────────────

// instanceResp is the JSON shape we return to clients. The sqlc-
// generated WaInstance uses pgtype.UUID / pgtype.Text / etc. which
// serialize as ugly nested {bytes, valid} objects. Flatten to plain
// strings + nulls here.
type instanceResp struct {
	ID                   string     `json:"id"`
	TenantID             string     `json:"tenantId"`
	Label                string     `json:"label"`
	PhoneNumber          *string    `json:"phoneNumber,omitempty"`
	Status               string     `json:"status"`
	LastConnectedAt      *time.Time `json:"lastConnectedAt,omitempty"`
	LastDisconnectReason *string    `json:"lastDisconnectReason,omitempty"`
	AiEnabled            bool       `json:"aiEnabled"`
	AiProvider           *string    `json:"aiProvider,omitempty"`
	AiModel              *string    `json:"aiModel,omitempty"`
	AiSystemPrompt       *string    `json:"aiSystemPrompt,omitempty"`
	AiTemperature        *string    `json:"aiTemperature,omitempty"`
	AiMaxHistory         int32      `json:"aiMaxHistory"`
	AiProviderConfigID   *string    `json:"aiProviderConfigId,omitempty"`
	// Handoff (JUR-74). admin_phone is E.164 without leading +, e.g.
	// "628987654321". Must differ from PhoneNumber — UI validates.
	AdminPhone             *string `json:"adminPhone,omitempty"`
	HandoffAutoResumeHours int32   `json:"handoffAutoResumeHours"`
	OtpLoginEnabled        bool    `json:"otpLoginEnabled"`
	CreatedAt              time.Time `json:"createdAt"`
	UpdatedAt              time.Time `json:"updatedAt"`
}

func toInstanceResp(i queries.WaInstance) instanceResp {
	return instanceResp{
		ID:                   db.UUIDString(i.ID),
		TenantID:             db.UUIDString(i.TenantID),
		Label:                i.Label,
		PhoneNumber:          textPtr(i.PhoneNumber),
		Status:               i.Status,
		LastConnectedAt:      timePtr(i.LastConnectedAt),
		LastDisconnectReason: textPtr(i.LastDisconnectReason),
		AiEnabled:            i.AiEnabled,
		AiProvider:           textPtr(i.AiProvider),
		AiModel:              textPtr(i.AiModel),
		AiSystemPrompt:       textPtr(i.AiSystemPrompt),
		AiTemperature:        textPtr(i.AiTemperature),
		AiMaxHistory:         i.AiMaxHistory,
		AiProviderConfigID:     uuidPtr(i.AiProviderConfigID),
		AdminPhone:             textPtr(i.AdminPhone),
		HandoffAutoResumeHours: i.HandoffAutoResumeHours,
		OtpLoginEnabled:        i.OtpLoginEnabled,
		CreatedAt:              i.CreatedAt.Time,
		UpdatedAt:              i.UpdatedAt.Time,
	}
}

type createInstanceReq struct {
	Label string `json:"label"`
}

type updateInstanceReq struct {
	Label                  *string `json:"label,omitempty"`
	AiEnabled              *bool   `json:"aiEnabled,omitempty"`
	AiProvider             *string `json:"aiProvider,omitempty"`
	AiModel                *string `json:"aiModel,omitempty"`
	AiSystemPrompt         *string `json:"aiSystemPrompt,omitempty"`
	AiTemperature          *string `json:"aiTemperature,omitempty"`
	AiMaxHistory           *int32  `json:"aiMaxHistory,omitempty"`
	AiProviderConfigID     *string `json:"aiProviderConfigId,omitempty"`
	AdminPhone             *string `json:"adminPhone,omitempty"`
	HandoffAutoResumeHours *int32  `json:"handoffAutoResumeHours,omitempty"`
	// Per-instance kill switch for the staff WhatsApp OTP login flow.
	// When false (the default), the inbound detector short-circuits and
	// the public /auth/wa-login/* endpoints return wa_login_unavailable
	// for this tenant even if tier + paired status allow.
	OtpLoginEnabled *bool `json:"otpLoginEnabled,omitempty"`
}

// ── Handlers ──────────────────────────────────────────────────────

// Create POST /v1/wa/instances { label }
func (h *WaInstances) Create(c *fiber.Ctx) error {
	ctx := middleware.TenantFrom(c)

	var req createInstanceReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	if l := len(req.Label); l < 1 || l > 100 {
		return badRequest(c, "label must be 1..100 chars")
	}

	tenantID, err := db.ParseUUID(ctx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	inst, err := h.q.CreateWaInstance(c.UserContext(), queries.CreateWaInstanceParams{
		TenantID: tenantID,
		Label:    req.Label,
	})
	if err != nil {
		return internalError(c, err)
	}

	// Seed the basic-tier RAG tools as enabled by default so new tenants
	// don't land on an instance with every retrieval silently disabled.
	// Best-effort: the instance is already created, so a seed failure
	// shouldn't 500 the request — the operator can still toggle tools
	// manually in Pengaturan AI if this fails.
	if err := h.q.SeedDefaultRagToolsForInstance(c.UserContext(), inst.ID); err != nil {
		slog.Warn("seed default rag tools failed",
			"instance", db.UUIDString(inst.ID), "err", err)
	}

	return c.Status(fiber.StatusCreated).JSON(toInstanceResp(inst))
}

// List GET /v1/wa/instances
func (h *WaInstances) List(c *fiber.Ctx) error {
	ctx := middleware.TenantFrom(c)

	tenantID, err := db.ParseUUID(ctx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	rows, err := h.q.ListWaInstancesByTenant(c.UserContext(), tenantID)
	if err != nil {
		return internalError(c, err)
	}
	out := make([]instanceResp, len(rows))
	for i, r := range rows {
		out[i] = toInstanceResp(r)
	}
	return c.JSON(out)
}

// Get GET /v1/wa/instances/:id
func (h *WaInstances) Get(c *fiber.Ctx) error {
	ctx := middleware.TenantFrom(c)

	id, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		// Treat as 404 — never reveal whether the id exists for a
		// different tenant.
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(ctx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	inst, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
		ID: id, TenantID: tenantID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}
	return c.JSON(toInstanceResp(inst))
}

// Update PATCH /v1/wa/instances/:id
func (h *WaInstances) Update(c *fiber.Ctx) error {
	ctx := middleware.TenantFrom(c)

	id, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(ctx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	var req updateInstanceReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}

	// Require at least one field — otherwise the request is a no-op
	// and the client likely sent it by mistake.
	if req.Label == nil && req.AiEnabled == nil && req.AiProvider == nil &&
		req.AiModel == nil && req.AiSystemPrompt == nil &&
		req.AiTemperature == nil && req.AiMaxHistory == nil &&
		req.AiProviderConfigID == nil && req.AdminPhone == nil &&
		req.HandoffAutoResumeHours == nil && req.OtpLoginEnabled == nil {
		return badRequest(c, "no fields to update")
	}

	// Field-by-field bounds checks. Skip when the pointer is nil
	// (caller chose to leave the column alone).
	if req.Label != nil && (len(*req.Label) < 1 || len(*req.Label) > 100) {
		return badRequest(c, "label must be 1..100 chars")
	}
	if req.AiProvider != nil && *req.AiProvider != "openai" && *req.AiProvider != "gemini" {
		return badRequest(c, "aiProvider must be openai|gemini")
	}
	if req.AiMaxHistory != nil && (*req.AiMaxHistory < 1 || *req.AiMaxHistory > 50) {
		return badRequest(c, "aiMaxHistory must be 1..50")
	}
	// Handoff (JUR-74) field validation.
	if req.HandoffAutoResumeHours != nil && (*req.HandoffAutoResumeHours < 0 || *req.HandoffAutoResumeHours > 168) {
		return badRequest(c, "handoffAutoResumeHours must be 0..168")
	}
	// admin_phone equality with instance's own phone is checked AFTER
	// instance fetch below — we need the current phoneNumber to compare.

	// Validate aiProviderConfigId. Empty string is allowed and means
	// "unpin — fall back to platform default". Any non-empty value must
	// parse as a UUID and reference an active row.
	aiProviderConfigParam := pgtype.UUID{Valid: false}
	if req.AiProviderConfigID != nil {
		if *req.AiProviderConfigID == "" {
			// Explicit clear — pass a "valid zero UUID" sentinel is not safe
			// because COALESCE would still treat it as a value. We bypass the
			// COALESCE by issuing a separate direct UPDATE below.
		} else {
			parsed, err := db.ParseUUID(*req.AiProviderConfigID)
			if err != nil {
				return badRequest(c, "invalid aiProviderConfigId")
			}
			// Ensure the config exists and is active to avoid pinning to a
			// soft-deleted/inactive entry.
			cfg, err := h.q.GetAiProviderConfig(c.UserContext(), parsed)
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return badRequest(c, "aiProviderConfigId not found")
				}
				return internalError(c, err)
			}
			if !cfg.IsActive {
				return badRequest(c, "aiProviderConfigId is inactive")
			}
			aiProviderConfigParam = parsed
		}
	}

	// If the caller asked to clear the pin (empty string), do it in a
	// separate UPDATE — COALESCE would otherwise treat NULL as "leave
	// alone".
	if req.AiProviderConfigID != nil && *req.AiProviderConfigID == "" {
		if err := h.q.ClearWaInstanceAiProviderConfig(c.UserContext(), queries.ClearWaInstanceAiProviderConfigParams{
			ID:       id,
			TenantID: tenantID,
		}); err != nil {
			return internalError(c, err)
		}
	}

	// admin_phone validation + canonicalisation. Empty string is treated
	// as "clear admin_phone". For a non-empty value:
	//   1. Run through whatsapp.NormalizeJID so we store the canonical
	//      digit-only E.164 form ("08118492869" → "628118492869").
	//      Without this, naive concatenation later produced
	//      "08118492869@s.whatsapp.net" which is not a valid WhatsApp
	//      JID — USync stalls and admin notifications never deliver.
	//   2. Reject when it equals the instance's own paired number
	//      (whatsmeow rejects self-sends).
	if req.AdminPhone != nil && *req.AdminPhone != "" {
		jid, err := whatsapp.NormalizeJID(*req.AdminPhone)
		if err != nil {
			return badRequest(c, "adminPhone is not a valid phone number: "+err.Error())
		}
		// Strip the "@s.whatsapp.net" suffix — the column stores only
		// the digit-only number; the JID is reconstructed at send time.
		canonical := jid
		if at := strings.IndexByte(canonical, '@'); at >= 0 {
			canonical = canonical[:at]
		}
		req.AdminPhone = &canonical

		current, err := h.q.GetWaInstance(c.UserContext(), queries.GetWaInstanceParams{
			ID: id, TenantID: tenantID,
		})
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return internalError(c, err)
		}
		if current.PhoneNumber.Valid {
			if normalizeDigits(current.PhoneNumber.String) == canonical {
				return badRequest(c, "adminPhone must be different from this instance's own number")
			}
		}
	}

	inst, err := h.q.UpdateWaInstance(c.UserContext(), queries.UpdateWaInstanceParams{
		ID:                      id,
		TenantID:                tenantID,
		Label:                   textParam(req.Label),
		AiEnabled:               boolParam(req.AiEnabled),
		AiProvider:              textParam(req.AiProvider),
		AiModel:                 textParam(req.AiModel),
		AiSystemPrompt:          textParam(req.AiSystemPrompt),
		AiTemperature:           textParam(req.AiTemperature),
		AiMaxHistory:            int4Param(req.AiMaxHistory),
		AiProviderConfigID:      aiProviderConfigParam,
		AdminPhone:              textParam(req.AdminPhone),
		HandoffAutoResumeHours:  int4Param(req.HandoffAutoResumeHours),
		OtpLoginEnabled:         boolParam(req.OtpLoginEnabled),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}
	return c.JSON(toInstanceResp(inst))
}

// Delete DELETE /v1/wa/instances/:id
//
// Order of operations:
//  1. DB delete (FK cascade kills wa_messages + wa_contacts).
//  2. Registry purge: close the in-memory whatsmeow socket AND remove
//     the per-instance SQLite session file from disk.
//  3. S3 batch delete: every key under {tenantId}/wa/{instanceId}/.
//     Saves us waiting up to 3 days for the kind=wa-media lifecycle.
//
// Steps 2 + 3 are best-effort — failures are logged but don't fail
// the request. The DB delete already happened; orphaned in-memory
// state self-heals on next api restart, and orphaned S3 objects are
// caught by the lifecycle rule eventually.
func (h *WaInstances) Delete(c *fiber.Ctx) error {
	tCtx := middleware.TenantFrom(c)

	id, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	tenantID, err := db.ParseUUID(tCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	n, err := h.q.DeleteWaInstance(c.UserContext(), queries.DeleteWaInstanceParams{
		ID: id, TenantID: tenantID,
	})
	if err != nil {
		return internalError(c, err)
	}
	if n == 0 {
		// Either id is bogus OR belongs to another tenant. Both
		// surface as 404 — never leak which is which.
		return notFound(c)
	}

	instanceIDStr := db.UUIDString(id)

	// Best-effort cleanup. Use a fresh background context so cancellation
	// from the HTTP request returning doesn't abort halfway through.
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if h.registry != nil {
		if err := h.registry.Purge(cleanupCtx, instanceIDStr); err != nil {
			slog.Warn("wa.Delete: registry purge failed",
				"instance", instanceIDStr, "err", err)
		}
	}
	if h.s3 != nil {
		prefix := tCtx.TenantID + "/wa/" + instanceIDStr + "/"
		deleted, err := h.s3.DeletePrefix(cleanupCtx, prefix)
		if err != nil {
			slog.Warn("wa.Delete: s3 prefix delete failed",
				"instance", instanceIDStr, "prefix", prefix,
				"deleted", deleted, "err", err)
		} else if deleted > 0 {
			slog.Info("wa.Delete: s3 media purged",
				"instance", instanceIDStr, "deleted", deleted)
		}
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// ── pgtype helpers (request side) ─────────────────────────────────

func textParam(p *string) pgtype.Text {
	if p == nil {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: *p, Valid: true}
}

func boolParam(p *bool) pgtype.Bool {
	if p == nil {
		return pgtype.Bool{Valid: false}
	}
	return pgtype.Bool{Bool: *p, Valid: true}
}

func int4Param(p *int32) pgtype.Int4 {
	if p == nil {
		return pgtype.Int4{Valid: false}
	}
	return pgtype.Int4{Int32: *p, Valid: true}
}

// ── pgtype helpers (response side) ────────────────────────────────

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	v := t.String
	return &v
}

func uuidPtr(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	v := db.UUIDString(u)
	return &v
}

func timePtr(t pgtype.Timestamp) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

// normalizeDigits strips every non-digit so we can compare phone
// numbers regardless of formatting (+62, leading 0, dashes, spaces).
// Used for the admin_phone self-send guard.
func normalizeDigits(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= '0' && c <= '9' {
			out = append(out, c)
		}
	}
	return string(out)
}

// ── Response helpers (shared with future handlers) ────────────────

func badRequest(c *fiber.Ctx, msg string) error {
	return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": msg})
}

func notFound(c *fiber.Ctx) error {
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
}

func internalError(c *fiber.Ctx, err error) error {
	// TODO(JUR-42): structured slog with request id correlation.
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
		"error":  "internal server error",
		"detail": err.Error(),
	})
}
