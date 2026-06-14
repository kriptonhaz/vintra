// Package http builds the Fiber app for the api service.
//
// Two layers of routes mounted under /v1:
//   - Public: /ping (and later /healthz, /readyz). No middleware.
//   - Authed: per-route Auth + Tenant middleware. /me, /wa/*.
//
// Middleware is attached PER-ROUTE, not via group.Use — group-level
// Use would catch unmatched paths under /v1 and return 401 instead of
// the 404 fallback. Keep this file's route table the canonical list
// of "what's exposed and what's protected".
package http

import (
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/recover"
	goredis "github.com/redis/go-redis/v9"

	"github.com/kriptonhaz/vintra/apps/api/internal/auth"
	"github.com/kriptonhaz/vintra/apps/api/internal/config"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/handlers"
	"github.com/kriptonhaz/vintra/apps/api/internal/http/middleware"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	"github.com/kriptonhaz/vintra/apps/api/internal/storage"
	"github.com/kriptonhaz/vintra/apps/api/internal/tenant"
	"github.com/kriptonhaz/vintra/apps/api/internal/walogin"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// Deps bundles everything NewServer needs from the bootstrap. Adding a
// new subsystem (whatsmeow registry, asynq client, etc.) means adding
// a field here and a route-register call below.
type Deps struct {
	Config   *config.Config
	Verifier *auth.Verifier
	Tenant   *tenant.Service
	Queries  *queries.Queries
	// Raw pool — needed by the RAG preview handler so retrievers can
	// run ad-hoc SQL outside the sqlc-generated wrappers. Same pool
	// the Queries are built from.
	DBPool      queries.DBTX
	Registry    *whatsapp.Registry
	AsynqClient *queue.Client
	// Redis client — used by the readyz handler to ping for liveness
	// and by future rate-limit token-bucket middleware (JUR-43).
	Redis *goredis.Client
	// AppVersion surfaces in /healthz so monitoring can confirm a
	// deploy actually rolled. Populate from build-time -ldflags or git
	// SHA; "dev" is the safe fallback for local runs.
	AppVersion string
	// S3 — used by the wa.Delete handler to batch-delete the deleted
	// instance's media. Optional; nil falls back to "lifecycle rule
	// will eventually clean it up" (JUR-79, 3-day expiry on
	// kind=wa-media).
	S3 *storage.Client
	// WaLogin — staff WhatsApp OTP login service. Used by the public
	// /auth/wa-login/* endpoints AND by the wa:incoming worker (passed
	// separately into queue/tasks). Both share the same Service instance
	// so the per-phone rate-limit buckets cover both surfaces.
	WaLogin *walogin.Service
}

// NewServer returns a configured *fiber.App with /v1 routes mounted.
// Doesn't call Listen — the caller (main.go) owns the lifecycle so it
// can wire graceful shutdown on its own ctx.
func NewServer(deps Deps) *fiber.App {
	app := fiber.New(fiber.Config{
		AppName:               "vintra-api",
		DisableStartupMessage: true, // we log our own structured "listening" line
	})

	// Recover from any panic in a handler and return a 500. Without this
	// a single panic in any future handler kills the whole process.
	app.Use(recover.New())

	v1 := app.Group("/v1")

	// Pre-build middleware funcs once — attach per-route below.
	authMW := middleware.Auth(deps.Verifier)
	tenantMW := middleware.Tenant(deps.Tenant)

	// Public — no auth, no tenant.
	v1.Get("/ping", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"ok":      true,
			"service": "vintra-api",
		})
	})

	// Public — staff WhatsApp OTP login. Pre-session (the user is by
	// definition unauthenticated at this point). Anti-enumeration:
	// both endpoints return the same generic error shape for "tenant
	// unknown" vs "feature unavailable" vs "phone not registered" so
	// an attacker can't probe which tenants have which staff.
	if deps.WaLogin != nil {
		waLogin := handlers.NewWALogin(deps.Queries, deps.WaLogin)
		v1.Post("/auth/wa-login/request", waLogin.Request)
		v1.Post("/auth/wa-login/verify", waLogin.Verify)
	}

	// Ops endpoints — public, no auth, NO /v1 prefix so monitoring
	// configurations stay short and version-stable. Liveness vs
	// readiness split lets the LB drop bad instances without process
	// supervisors needlessly restarting them.
	health := handlers.NewHealth(deps.DBPool, deps.Redis, deps.Registry, deps.AppVersion)
	app.Get("/healthz", health.Healthz)
	app.Get("/readyz", health.Readyz)

	// Authed (auth + tenant resolution).
	v1.Get("/me", authMW, tenantMW, handlers.Me)

	// WhatsApp instances CRUD (JUR-63) + lifecycle (JUR-66).
	wa := handlers.NewWaInstances(deps.Queries, deps.Registry, deps.S3)
	v1.Post("/wa/instances", authMW, tenantMW, wa.Create)
	v1.Get("/wa/instances", authMW, tenantMW, wa.List)
	v1.Get("/wa/instances/:id", authMW, tenantMW, wa.Get)
	v1.Patch("/wa/instances/:id", authMW, tenantMW, wa.Update)
	v1.Delete("/wa/instances/:id", authMW, tenantMW, wa.Delete)

	lifecycle := handlers.NewWaLifecycle(deps.Queries, deps.Registry)
	v1.Post("/wa/instances/:id/connect", authMW, tenantMW, lifecycle.Connect)
	v1.Post("/wa/instances/:id/pair-code", authMW, tenantMW, lifecycle.PairCode)
	v1.Post("/wa/instances/:id/disconnect", authMW, tenantMW, lifecycle.Disconnect)
	v1.Get("/wa/instances/:id/status", authMW, tenantMW, lifecycle.Status)

	// Messages: send (enqueues wa:send via asynq), list (conversation tail).
	msgs := handlers.NewWaMessages(deps.Queries, deps.AsynqClient)
	v1.Post("/wa/instances/:id/messages", authMW, tenantMW, msgs.Send)
	v1.Post("/wa/instances/:id/messages/image", authMW, tenantMW, msgs.SendImage)
	v1.Get("/wa/instances/:id/messages", authMW, tenantMW, msgs.List)
	// Single-message lookup for media URL signing (JUR-77).
	v1.Get("/wa/messages/:id", authMW, tenantMW, msgs.Get)

	// Contacts for the chat-style UI sidebar.
	contacts := handlers.NewWaContacts(deps.Queries)
	v1.Get("/wa/instances/:id/contacts", authMW, tenantMW, contacts.List)
	v1.Post("/wa/instances/:id/contacts/read", authMW, tenantMW, contacts.MarkRead)

	// WA subscription status — plan, usage, limits.
	waSub := handlers.NewWaSubscription(deps.Queries)
	v1.Get("/wa/subscription", authMW, tenantMW, waSub.Get)

	// AI usage analytics — monthly cost + message count for the dashboard widget.
	aiUsage := handlers.NewAiUsage(deps.Queries)
	v1.Get("/ai/usage/monthly", authMW, tenantMW, aiUsage.Monthly)
	// Active AI provider configs the tenant can pin in WhatsApp settings.
	// Returns metadata only — never api_key / base_url.
	v1.Get("/ai/providers", authMW, tenantMW, aiUsage.AvailableProviders)

	// Internal-only routes — auth via shared INTERNAL_SERVICE_TOKEN, NOT
	// per-user JWT. The TanStack web app calls these from server functions
	// that have already done requirePlatformAdmin(), then forwards the
	// shared secret. Never tenant-scoped.
	internalMW := middleware.InternalServiceToken(deps.Config.InternalServiceToken)
	ragPreview := handlers.NewRagPreview(deps.Queries, deps.DBPool)
	v1.Post("/internal/rag/preview", internalMW, ragPreview.Preview)

	// Storefront checkout → admin WhatsApp notification. The web's
	// unauthenticated placeOrder calls this with the tenant + instance
	// id; recipient is the instance's own admin_phone (no arbitrary to).
	waNotify := handlers.NewWaInternalNotify(deps.Queries, deps.AsynqClient)
	v1.Post("/internal/wa/notify", internalMW, waNotify.Send)

	// System metrics for the web's /admin/monitoring page. The web
	// fetches this so its monitoring view always reflects the api's
	// host (= prod Lightsail) even when the operator is viewing from
	// localhost dev.
	systemMetrics := handlers.NewSystemMetrics("/home/ubuntu/prod/vintra-api/data")
	v1.Get("/internal/system-metrics", internalMW, systemMetrics.Get)

	// Per-instance RAG tool toggles for tenants.
	ragInstance := handlers.NewRagInstance(deps.Queries)
	v1.Get("/wa/instances/:id/rag-tools", authMW, tenantMW, ragInstance.List)
	v1.Patch("/wa/instances/:id/rag-tools/:toolId", authMW, tenantMW, ragInstance.Update)

	// Handoff workflow (JUR-74) — manual resume / pause AI for a
	// specific contact. Tenant-scoped via the instance lookup. JID is
	// passed in the request body, NOT a path param: WhatsApp JIDs
	// contain `@` and `.` which Fiber's path parser will silently
	// truncate (the `.` is treated as a route delimiter), causing the
	// UPDATE to match zero rows. Same pattern as `/contacts/read`.
	waHandoff := handlers.NewWaHandoff(deps.Queries)
	v1.Patch("/wa/instances/:id/contacts/handoff", authMW, tenantMW, waHandoff.Update)

	// Fall-through 404. Fiber returns plaintext "Cannot GET /foo" by
	// default; we want JSON so clients can rely on a uniform error shape.
	app.Use(func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "not found",
			"path":  c.Path(),
		})
	})

	return app
}
