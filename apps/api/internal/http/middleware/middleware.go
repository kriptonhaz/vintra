// Package middleware wires the auth + tenant chain into Fiber.
//
// Two ordered middlewares:
//   1. Auth — extracts the JWT (Authorization header OR sb-access-token
//      cookie), verifies via Supabase, attaches userID to ctx.Locals.
//   2. Tenant — resolves the user's tenant_members row, attaches
//      *tenant.Ctx to ctx.Locals. 403 if no membership.
//
// Public routes (the public Group in http/server.go) skip both —
// the middlewares are attached only to the authed Group, not globally.
//
// Downstream handlers pull the tenant ctx via the package-level
// TenantFrom helper, which throws 403 if it's missing (defensive
// guard against accidental misuse).
package middleware

import (
	"context"
	"crypto/subtle"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/kriptonhaz/vintra/apps/api/internal/auth"
	"github.com/kriptonhaz/vintra/apps/api/internal/tenant"
)

// ctx local keys. Unexported types prevent collision with handler-set
// values that happen to share the same string key.
type localKey int

const (
	keyUserID localKey = iota
	keyTenantCtx
)

// Auth verifies the Supabase JWT on every request. Sets the user id
// on the Fiber locals; returns 401 on failure.
func Auth(v *auth.Verifier) fiber.Handler {
	return func(c *fiber.Ctx) error {
		token, ok := extractToken(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "missing access token",
			})
		}

		user, err := v.Verify(reqContext(c), token)
		if err != nil {
			if errors.Is(err, auth.ErrInvalidToken) {
				return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
					"error": "invalid or expired token",
				})
			}
			// 5xx upstream from Supabase. We don't want to mask infra
			// problems as auth problems — return 502.
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
				"error": "auth service unavailable",
			})
		}

		c.Locals(keyUserID, user.ID)
		return c.Next()
	}
}

// Tenant resolves the authenticated user's tenant membership. Must
// be chained AFTER Auth — depends on userID being in locals.
//
// Returns 403 when the user has no tenant_members row.
func Tenant(svc *tenant.Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := c.Locals(keyUserID).(string)
		if !ok || userID == "" {
			// Fail closed: this means middleware order is wrong, not a
			// user error. 500 instead of 401 so we notice in logs.
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "tenant middleware reached without authenticated user",
			})
		}

		tc, err := svc.Get(reqContext(c), userID)
		if err != nil {
			if errors.Is(err, tenant.ErrNoMembership) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "no tenant membership",
				})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "tenant lookup failed",
			})
		}

		c.Locals(keyTenantCtx, tc)
		return c.Next()
	}
}

// TenantFrom returns the per-request tenant context. Handlers that
// pass through Auth + Tenant always have it; calling this from a
// public route panics intentionally — that's a programmer error, not
// a runtime condition.
func TenantFrom(c *fiber.Ctx) *tenant.Ctx {
	tc, ok := c.Locals(keyTenantCtx).(*tenant.Ctx)
	if !ok || tc == nil {
		// Don't 500 silently — the route was misconfigured. Panic so
		// the panic-recover middleware logs and returns 500.
		panic("middleware: TenantFrom called without Tenant middleware in chain")
	}
	return tc
}

// InternalServiceToken protects /v1/internal/* routes with a shared
// secret. The TanStack web app authenticates the platform admin via
// requirePlatformAdmin() (Drizzle lookup against platform_admins) and
// then forwards the call to Go with `Authorization: Bearer <token>`.
//
// Go itself has no platform-admin concept — the trust boundary is the
// shared secret. Token comes from cfg.InternalServiceToken (env var
// INTERNAL_SERVICE_TOKEN). An empty configured token disables every
// internal route as a fail-safe — never allow an empty header to match
// an empty config.
func InternalServiceToken(token string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if token == "" {
			// Misconfiguration: env var unset in prod. 503 so an alert
			// fires instead of silently exposing the route.
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"error": "internal service token not configured",
			})
		}
		h := c.Get(fiber.HeaderAuthorization)
		if len(h) < 7 || !strings.EqualFold(h[:7], "Bearer ") {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "missing internal service token",
			})
		}
		got := strings.TrimSpace(h[7:])
		// Constant-time compare to avoid leaking token length via timing.
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid internal service token",
			})
		}
		return c.Next()
	}
}

// extractToken returns the JWT from the Authorization header (preferred)
// or the sb-access-token cookie. Trims whitespace. Returns "" if neither
// is present.
func extractToken(c *fiber.Ctx) (string, bool) {
	if h := c.Get(fiber.HeaderAuthorization); h != "" {
		// Case-insensitive "Bearer " prefix per RFC 6750. Header values
		// are usually canonical-cased but be defensive.
		if len(h) >= 7 && strings.EqualFold(h[:7], "Bearer ") {
			t := strings.TrimSpace(h[7:])
			if t != "" {
				return t, true
			}
		}
	}
	if c.Cookies("sb-access-token") != "" {
		return strings.TrimSpace(c.Cookies("sb-access-token")), true
	}
	return "", false
}

// reqContext returns the per-request context.Context, so verifier
// + service calls cancel when the client disconnects.
func reqContext(c *fiber.Ctx) context.Context {
	return c.UserContext()
}
