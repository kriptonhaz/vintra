package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/kriptonhaz/vintra/apps/api/internal/ai"
	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/rag"
)

// RagPreview serves the admin "test a tool definition" panel.
//
// Auth lives in the InternalServiceToken middleware — this handler
// trusts the caller has already proven they're a platform admin via
// the TanStack-side requirePlatformAdmin() check, then forwarded the
// shared secret. Do NOT re-verify; do NOT run the tenant chain.
type RagPreview struct {
	q      *queries.Queries
	dbpool queries.DBTX
}

func NewRagPreview(q *queries.Queries, dbpool queries.DBTX) *RagPreview {
	return &RagPreview{q: q, dbpool: dbpool}
}

type ragPreviewReq struct {
	TenantID  string `json:"tenantId"`
	Message   string `json:"message"`
	RemoteJid string `json:"remoteJid,omitempty"`
}

type ragPreviewSnippet struct {
	ToolID    string `json:"toolId"`
	Source    string `json:"source"`
	Text      string `json:"text"`
	LatencyMs int64  `json:"latencyMs"`
}

type ragPreviewRawRows struct {
	ToolID    string           `json:"toolId"`
	ToolName  string           `json:"toolName"`
	Rows      []map[string]any `json:"rows"`
	LatencyMs int64            `json:"latencyMs"`
}

type ragPreviewResp struct {
	Snippets        []ragPreviewSnippet `json:"snippets"`
	RawRows         []ragPreviewRawRows `json:"rawRows"`
	TotalMs         int64               `json:"totalMs"`
	EstimatedTokens int                 `json:"estimatedTokens"`
}

// Preview POST /v1/internal/rag/preview
//
// Loads every active tool, runs rag.Retrieve with currentTier="enterprise"
// (bypasses tier gating so admin sees what each tool would produce regardless
// of any specific tenant's plan), verbose=true (populates RawRows). Always
// runs against real tenant data — admin picks which tenant in the UI.
func (h *RagPreview) Preview(c *fiber.Ctx) error {
	var req ragPreviewReq
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid JSON body")
	}
	if req.TenantID == "" {
		return badRequest(c, "tenantId is required")
	}
	if req.Message == "" {
		return badRequest(c, "message is required")
	}

	tenantID, err := db.ParseUUID(req.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenantId")
	}

	ctx := c.UserContext()

	// Pull every active tool, then synthesize the GetInstanceEnabledRagToolsRow
	// shape Retrieve expects. Preview ignores per-instance opt-in toggles by
	// design (admin is testing the tool definition, not any one instance's
	// config), so we mark every tool Enabled=true.
	tools, err := h.q.ListActiveRagTools(ctx)
	if err != nil {
		return internalError(c, err)
	}
	rows := make([]queries.GetInstanceEnabledRagToolsRow, len(tools))
	for i, t := range tools {
		rows[i] = queries.GetInstanceEnabledRagToolsRow{
			ID:              t.ID,
			Name:            t.Name,
			Description:     t.Description,
			RetrievalType:   t.RetrievalType,
			MinTier:         t.MinTier,
			TriggerMode:     t.TriggerMode,
			TriggerKeywords: t.TriggerKeywords,
			SortOrder:       t.SortOrder,
			IsActive:        t.IsActive,
			CreatedAt:       t.CreatedAt,
			UpdatedAt:       t.UpdatedAt,
			Enabled:         true,
		}
	}

	start := time.Now()
	// "enterprise" tier bypasses the per-tool min_tier gate inside Retrieve.
	// Preview is one-shot — no conversation history, so incomingBody == searchBody.
	snippets, err := rag.Retrieve(ctx, h.dbpool, tenantID, "enterprise", req.RemoteJid, req.Message, req.Message, rows, true)
	totalMs := time.Since(start).Milliseconds()
	if err != nil {
		return internalError(c, err)
	}

	// Map tool ids → names so the rawRows section can label each accordion.
	toolName := make(map[string]string, len(tools))
	for _, t := range tools {
		toolName[db.UUIDString(t.ID)] = t.Name
	}

	respSnippets := make([]ragPreviewSnippet, len(snippets))
	respRaw := make([]ragPreviewRawRows, 0, len(snippets))
	totalChars := 0
	for i, s := range snippets {
		respSnippets[i] = ragPreviewSnippet{
			ToolID:    s.ToolID,
			Source:    s.Source,
			Text:      s.Text,
			LatencyMs: s.LatencyMs,
		}
		totalChars += len(s.Text)
		if len(s.RawRows) > 0 {
			respRaw = append(respRaw, ragPreviewRawRows{
				ToolID:    s.ToolID,
				ToolName:  toolName[s.ToolID],
				Rows:      s.RawRows,
				LatencyMs: s.LatencyMs,
			})
		}
	}

	return c.JSON(ragPreviewResp{
		Snippets:        respSnippets,
		RawRows:         respRaw,
		TotalMs:         totalMs,
		EstimatedTokens: ai.EstimateTokens(joinSnippetTexts(snippets)),
	})
}

func joinSnippetTexts(snippets []rag.Snippet) string {
	n := 0
	for _, s := range snippets {
		n += len(s.Text) + 1
	}
	out := make([]byte, 0, n)
	for i, s := range snippets {
		if i > 0 {
			out = append(out, '\n')
		}
		out = append(out, s.Text...)
	}
	return string(out)
}
