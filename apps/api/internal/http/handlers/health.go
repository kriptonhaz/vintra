package handlers

import (
	"context"
	"runtime"
	"time"

	"github.com/gofiber/fiber/v2"
	goredis "github.com/redis/go-redis/v9"

	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// Health bundles ops endpoints — /healthz (liveness) and /readyz
// (readiness). Both are public, no auth, no tenant scoping.
//
// Liveness vs readiness:
//   - /healthz answers "is the process alive and responsive?" — cheap,
//     no I/O. Used by process supervisors (systemd, PM2) to decide if
//     the process needs restarting.
//   - /readyz answers "should this process receive traffic?" — checks
//     downstream dependencies (Postgres, Redis). Used by load balancers
//     and uptime monitors. Returns 503 when any dep is unreachable so
//     the LB drops this instance from rotation until deps recover.
type Health struct {
	db         queries.DBTX
	redis      *goredis.Client
	registry   *whatsapp.Registry
	startedAt  time.Time
	appVersion string
}

func NewHealth(db queries.DBTX, redis *goredis.Client, registry *whatsapp.Registry, appVersion string) *Health {
	return &Health{
		db:         db,
		redis:      redis,
		registry:   registry,
		startedAt:  time.Now(),
		appVersion: appVersion,
	}
}

// Healthz GET /healthz
//
// Cheapest possible response: process is alive, here's how long. No
// downstream calls — this must succeed even if Postgres is on fire.
func (h *Health) Healthz(c *fiber.Ctx) error {
	return c.JSON(fiber.Map{
		"ok":      true,
		"uptime":  int(time.Since(h.startedAt).Seconds()),
		"version": h.appVersion,
		"go":      runtime.Version(),
	})
}

// Readyz GET /readyz
//
// Pings Postgres and Redis. Returns 503 with per-dep status if either
// fails. activeInstances is included so monitoring can alert on
// "api up but no whatsmeow sockets attached" — a likely sign of a
// crashed-and-restarted process where Revive failed.
//
// Total latency budget: 2s (each dep gets 1s). Above that we report
// the dep as failed even if a slow ack would eventually arrive — the
// LB needs a quick yes/no, not a slow correct answer.
func (h *Health) Readyz(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.UserContext(), 2*time.Second)
	defer cancel()

	pgStatus := "ok"
	if err := h.checkPostgres(ctx); err != nil {
		pgStatus = "fail: " + err.Error()
	}
	redisStatus := "ok"
	if err := h.checkRedis(ctx); err != nil {
		redisStatus = "fail: " + err.Error()
	}

	allOk := pgStatus == "ok" && redisStatus == "ok"
	resp := fiber.Map{
		"ok":              allOk,
		"postgres":        pgStatus,
		"redis":           redisStatus,
		"activeInstances": h.registry.ActiveCount(),
	}
	if !allOk {
		return c.Status(fiber.StatusServiceUnavailable).JSON(resp)
	}
	return c.JSON(resp)
}

func (h *Health) checkPostgres(ctx context.Context) error {
	pgCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	_, err := h.db.Exec(pgCtx, "SELECT 1")
	return err
}

func (h *Health) checkRedis(ctx context.Context) error {
	redisCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	return h.redis.Ping(redisCtx).Err()
}
