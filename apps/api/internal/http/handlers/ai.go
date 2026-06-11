package handlers

import (
	"fmt"

	"github.com/gofiber/fiber/v2"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
)

// AiUsage serves AI cost analytics endpoints.
type AiUsage struct {
	q *queries.Queries
}

func NewAiUsage(q *queries.Queries) *AiUsage {
	return &AiUsage{q: q}
}

type aiProviderBreakdown struct {
	Provider     string `json:"provider"`
	MessageCount int32  `json:"messageCount"`
	TotalCostUSD string `json:"totalCostUsd"` // 6-decimal string
}

type monthlyUsageResp struct {
	TotalCostUSD string                `json:"totalCostUsd"`
	TotalMessages int32               `json:"totalMessages"`
	Breakdown    []aiProviderBreakdown `json:"breakdown"`
}

// Monthly GET /v1/ai/usage/monthly
//
// Returns the tenant's AI usage totals for the current calendar month:
// total cost in USD, total message count, and a per-provider breakdown.
// Returns zero values when no AI calls have been made yet.
func (h *AiUsage) Monthly(c *fiber.Ctx) error {
	tenantCtx := middleware.TenantFrom(c)

	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	rows, err := h.q.MonthlyAiUsageByProvider(c.UserContext(), tenantID)
	if err != nil {
		return internalError(c, err)
	}

	breakdown := make([]aiProviderBreakdown, len(rows))
	var totalMessages int32
	var totalCostUSD float64

	for i, r := range rows {
		// total_cost is already `numeric::text` from the SQL, e.g.
		// "0.000123" or "0". Empty string would be a logic bug — never
		// expected because of the COALESCE — but guard anyway so the
		// frontend never receives a non-decimal string.
		costStr := r.TotalCost
		if costStr == "" {
			costStr = "0"
		}
		cost := parseFloatStr(costStr)
		totalCostUSD += cost
		totalMessages += r.MessageCount

		breakdown[i] = aiProviderBreakdown{
			Provider:     r.Provider,
			MessageCount: r.MessageCount,
			TotalCostUSD: costStr,
		}
	}

	return c.JSON(monthlyUsageResp{
		TotalCostUSD:  fmt.Sprintf("%.6f", totalCostUSD),
		TotalMessages: totalMessages,
		Breakdown:     breakdown,
	})
}

// availableProviderResp is the tenant-facing shape of an AI provider
// config — strictly metadata the UI needs to render a "Provider — Model"
// dropdown. NEVER includes the API key or base URL (those are admin-only).
type availableProviderResp struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ProviderType string `json:"providerType"`
	Model        string `json:"model"`
	IsDefault    bool   `json:"isDefault"`
}

// AvailableProviders GET /v1/ai/providers
//
// Lists active AI provider configs that the platform admin has set up,
// for tenant use in the WhatsApp instance settings panel. Active only —
// inactive configs are hidden from tenants.
func (h *AiUsage) AvailableProviders(c *fiber.Ctx) error {
	rows, err := h.q.ListActiveAiProviderConfigs(c.UserContext())
	if err != nil {
		return internalError(c, err)
	}
	out := make([]availableProviderResp, len(rows))
	for i, r := range rows {
		out[i] = availableProviderResp{
			ID:           db.UUIDString(r.ID),
			Name:         r.Name,
			ProviderType: r.ProviderType,
			Model:        r.Model,
			IsDefault:    r.IsDefault,
		}
	}
	return c.JSON(out)
}

func parseFloatStr(s string) float64 {
	var f float64
	fmt.Sscanf(s, "%f", &f)
	return f
}
