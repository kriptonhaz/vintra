package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
)

// WaSubscription serves the tenant's WA subscription status.
type WaSubscription struct {
	q *queries.Queries
}

func NewWaSubscription(q *queries.Queries) *WaSubscription {
	return &WaSubscription{q: q}
}

// Get GET /v1/wa/subscription
//
// Returns the tenant's current WA plan, monthly reply usage, and limits.
func (h *WaSubscription) Get(c *fiber.Ctx) error {
	ctx := c.UserContext()
	tenantCtx := middleware.TenantFrom(c)

	tenantID, err := db.ParseUUID(tenantCtx.TenantID)
	if err != nil {
		return badRequest(c, "invalid tenant id")
	}

	tier := "free"
	var subscriptionExpiresAt *string

	settings, err := h.q.GetWaSettings(ctx, tenantID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return internalError(c, err)
	}
	if err == nil {
		tier = settings.Tier
		if settings.SubscriptionExpiresAt.Valid {
			s := settings.SubscriptionExpiresAt.Time.UTC().Format("2006-01-02T15:04:05Z")
			subscriptionExpiresAt = &s
		}
	}

	plan, err := h.q.GetWaSubscriptionPlan(ctx, tier)
	if err != nil {
		// free tier or unknown tier — return zeros
		return c.JSON(fiber.Map{
			"tier":                  tier,
			"maxInstances":          0,
			"maxMonthlyReplies":     0,
			"usedReplies":           0,
			"subscriptionExpiresAt": subscriptionExpiresAt,
		})
	}

	usedReplies, err := h.q.CountMonthlyAiReplies(ctx, tenantID)
	if err != nil {
		return internalError(c, err)
	}

	return c.JSON(fiber.Map{
		"tier":                  tier,
		"maxInstances":          plan.MaxInstances,
		"maxMonthlyReplies":     plan.MaxMonthlyReplies,
		"usedReplies":           usedReplies,
		"subscriptionExpiresAt": subscriptionExpiresAt,
	})
}
