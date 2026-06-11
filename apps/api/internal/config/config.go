// Package config holds the env-var contract for the api service.
//
// Struct tags use caarlos0/env. Missing required vars cause Parse() to
// return an error and main.go exits non-zero before any Fiber routes
// get wired — much friendlier than a deep DI failure at first request.
//
// Fields fall into three buckets:
//   1. Runtime knobs with defaults — work out of the box.
//   2. Required external services — DB, Supabase, Redis. Hard fail
//      at boot if missing.
//   3. Optional providers (OpenAI, Gemini) — adapters validate their
//      own key at first call. Lets a tenant who only uses Gemini
//      boot without an OpenAI key set.
package config

import "github.com/caarlos0/env/v10"

type Config struct {
	// ── Runtime ──────────────────────────────────────────────────────
	NodeEnv  string `env:"NODE_ENV" envDefault:"development"`
	Port     int    `env:"PORT" envDefault:"4099"`
	LogLevel string `env:"LOG_LEVEL" envDefault:"info"`
	AppURL   string `env:"APP_URL" envDefault:"http://localhost:3000"`

	// ── Postgres (Supabase pooler — Transaction mode, port 6543) ─────
	// Same value as apps/web's DATABASE_URL. The pgx pool we open in
	// JUR-61 enforces `prepare: false` via pgxpool config (Supabase
	// transaction-mode pooler doesn't speak prepared statements).
	DatabaseURL string `env:"DATABASE_URL,required"`

	// ── Supabase Auth (server-only) ──────────────────────────────────
	// Both keys are server-only — never expose to the browser. The api
	// verifies Supabase JWTs issued by the SAME project that apps/web
	// logs the user into.
	SupabaseURL    string `env:"SUPABASE_URL,required"`
	SupabaseSecret string `env:"SUPABASE_SECRET_KEY,required"`

	// ── Redis (asynq + Baileys/whatsmeow auxiliary state) ────────────
	// Note: whatsmeow's session store is SQLite (file on disk), NOT
	// Redis. Redis here is for asynq queues, per-(instance,jid) locks,
	// dedupe SETs, and rate-limit token buckets.
	RedisURL string `env:"REDIS_URL,required"`

	// ── AI providers (optional — adapters validate at first call) ────
	OpenAIKey string `env:"OPENAI_API_KEY"`
	GeminiKey string `env:"GEMINI_API_KEY"`

	// ── Internal service token (TanStack → Go for admin preview) ─────
	// Shared secret checked by the /v1/internal/* endpoints.
	// Generate with: openssl rand -hex 32
	InternalServiceToken string `env:"INTERNAL_SERVICE_TOKEN"`

	// ── WhatsApp send rate limits (token bucket via Redis) ───────────
	// Two-level throttle: per-account (per-instance) AND per-recipient
	// (per-JID). Conservative defaults — bump only after watching how
	// WA reacts in production. Setting either to 0 disables that level.
	WaRatePerInstancePerSec float64 `env:"WA_RATE_PER_INSTANCE_PER_SEC" envDefault:"10"`
	WaRatePerJIDPerSec      float64 `env:"WA_RATE_PER_JID_PER_SEC" envDefault:"1"`
	WaRateBucketCapacity    int     `env:"WA_RATE_BUCKET_CAPACITY" envDefault:"5"`
	WaRateMaxWaitMs         int     `env:"WA_RATE_MAX_WAIT_MS" envDefault:"5000"`
}

// Parse reads the process env into a Config. Returns an error if any
// required var is missing or fails type coercion. Callers (main.go) are
// expected to log the error and exit non-zero — boot cannot proceed.
func Parse() (*Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// IsProduction returns true when NODE_ENV is "production". Used by
// log/slog setup and any other "behave-different-in-prod" branches.
func (c *Config) IsProduction() bool {
	return c.NodeEnv == "production"
}
