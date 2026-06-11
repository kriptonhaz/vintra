package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
	"github.com/kriptonhaz/vintra/apps/api/internal/tier"
)

// RagInstance serves the per-instance RAG tool toggles for tenants.
//
// Two endpoints:
//   - GET  /v1/wa/instances/:id/rag-tools          — list with enabled+locked state
//   - PATCH /v1/wa/instances/:id/rag-tools/:toolId — flip the enabled flag
//
// Both verify the instance belongs to the caller's tenant. Locked tools
// (tool.min_tier > tenant.tier) reject the PATCH with 403 even if the
// row was previously enabled (e.g. after a tier downgrade).
type RagInstance struct {
	q *queries.Queries
}

func NewRagInstance(q *queries.Queries) *RagInstance {
	return &RagInstance{q: q}
}

type ragToolRow struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Description     string   `json:"description,omitempty"`
	RetrievalType   string   `json:"retrievalType"`
	MinTier         string   `json:"minTier"`
	TriggerMode     string   `json:"triggerMode"`
	TriggerKeywords []string `json:"triggerKeywords"`
	Enabled         bool     `json:"enabled"`
	Locked          bool     `json:"locked"`
}

// List GET /v1/wa/instances/:id/rag-tools
func (h *RagInstance) List(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}
	instanceID, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}

	// Resolve the tenant's current tier — drives the `locked` flag.
	currentTier := ""
	if ws, err := h.q.GetWaSettings(c.UserContext(), tenantID); err == nil {
		currentTier = ws.Tier
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return internalError(c, err)
	}

	rows, err := h.q.ListInstanceRagToolsWithState(c.UserContext(), queries.ListInstanceRagToolsWithStateParams{
		InstanceID: instanceID,
		TenantID:   tenantID,
	})
	if err != nil {
		return internalError(c, err)
	}

	out := make([]ragToolRow, len(rows))
	for i, r := range rows {
		desc := ""
		if r.Description.Valid {
			desc = r.Description.String
		}
		out[i] = ragToolRow{
			ID:              db.UUIDString(r.ID),
			Name:            r.Name,
			Description:     desc,
			RetrievalType:   r.RetrievalType,
			MinTier:         r.MinTier,
			TriggerMode:     r.TriggerMode,
			TriggerKeywords: r.TriggerKeywords,
			Enabled:         r.Enabled,
			Locked:          !tier.AtLeast(currentTier, r.MinTier),
		}
	}
	return c.JSON(out)
}

type updateRagToolReq struct {
	Enabled bool `json:"enabled"`
}

// Update PATCH /v1/wa/instances/:id/rag-tools/:toolId
func (h *RagInstance) Update(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)
	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}
	instanceID, err := db.ParseUUID(c.Params("id"))
	if err != nil {
		return notFound(c)
	}
	toolID, err := db.ParseUUID(c.Params("toolId"))
	if err != nil {
		return notFound(c)
	}

	// Verify instance belongs to tenant — same scoping the GET path uses.
	if _, err := h.q.VerifyInstanceTenant(c.UserContext(), queries.VerifyInstanceTenantParams{
		ID: instanceID, TenantID: tenantID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(c)
		}
		return internalError(c, err)
	}

	var req updateRagToolReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}

	// Tier gate: enabling a tool above the tenant's tier is forbidden.
	// Disabling is always allowed, regardless of tier (so a downgraded
	// tenant can clean up stale enabled rows).
	if req.Enabled {
		tool, err := h.q.GetRagToolByID(c.UserContext(), toolID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return notFound(c)
			}
			return internalError(c, err)
		}
		currentTier := ""
		if ws, err := h.q.GetWaSettings(c.UserContext(), tenantID); err == nil {
			currentTier = ws.Tier
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return internalError(c, err)
		}
		if !tier.AtLeast(currentTier, tool.MinTier) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "tool requires a higher subscription tier",
			})
		}
	}

	if err := h.q.UpsertInstanceRagTool(c.UserContext(), queries.UpsertInstanceRagToolParams{
		InstanceID: instanceID,
		RagToolID:  toolID,
		Enabled:    req.Enabled,
	}); err != nil {
		return internalError(c, err)
	}
	return c.JSON(fiber.Map{"ok": true, "enabled": req.Enabled})
}
