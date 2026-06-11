// Command api is the entrypoint for the Vintra WhatsApp + AI api
// service. Bootstrap order:
//
//   1. Load .env (best-effort — missing file is fine in prod where
//      systemd supplies env via EnvironmentFile).
//   2. Parse + validate env (config.Parse). Boot aborts on failure.
//   3. Configure slog (JSON in prod, text in dev).
//   4. Open Postgres pool (pgx) + Redis client (go-redis). Both ping
//      at construction time so bad config surfaces at boot.
//   5. Construct Supabase verifier + tenant service (no I/O yet —
//      these are stateless wrappers).
//   6. Build the Fiber app (http.NewServer) with the bundled Deps.
//   7. Listen in a goroutine. Block on a signal-cancelled ctx for
//      graceful shutdown.
//
// Adding subsystems (whatsmeow, asynq) goes in this file — construct
// them after db/redis and pass into the Deps struct.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	wastore "go.mau.fi/whatsmeow/store"

	"github.com/kriptonhaz/vintra/apps/api/internal/ai"
	"github.com/kriptonhaz/vintra/apps/api/internal/auth"
	"github.com/kriptonhaz/vintra/apps/api/internal/config"
	"github.com/kriptonhaz/vintra/apps/api/internal/conversation"
	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	httpserver "github.com/kriptonhaz/vintra/apps/api/internal/http"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	queuetasks "github.com/kriptonhaz/vintra/apps/api/internal/queue/tasks"
	"github.com/kriptonhaz/vintra/apps/api/internal/ratelimit"
	"github.com/kriptonhaz/vintra/apps/api/internal/redis"
	"github.com/kriptonhaz/vintra/apps/api/internal/safego"
	"github.com/kriptonhaz/vintra/apps/api/internal/storage"
	"github.com/kriptonhaz/vintra/apps/api/internal/tenant"
	"github.com/kriptonhaz/vintra/apps/api/internal/walogin"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
)

// appVersion is overridden at build time via -ldflags "-X main.appVersion=..."
// (CI passes the git SHA). Defaults to "dev" for local runs so /healthz still
// returns something useful.
var appVersion = "dev"

func main() {
	// Best-effort .env load. Missing file is intentionally NOT an error
	// — prod uses systemd's EnvironmentFile= directive instead.
	_ = godotenv.Load()

	cfg, err := config.Parse()
	if err != nil {
		os.Stderr.WriteString("[api] invalid config: " + err.Error() + "\n")
		os.Exit(1)
	}

	setupLogger(cfg.LogLevel, cfg.NodeEnv)

	// Override whatsmeow's default device name so paired phones see
	// "Vintra" in Settings → Linked Devices instead of "whatsmeow".
	// Reference: https://github.com/tulir/whatsmeow/issues/89
	//
	// Caveat: this only affects FUTURE pairings. Existing paired
	// instances keep their old name until the user scans a new QR.
	wastore.SetOSInfo("Vintra", [3]uint32{1, 0, 0})

	// signal.NotifyContext gives us a ctx that cancels on SIGINT/SIGTERM.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// External connections — both ping at construction.
	database, err := db.New(ctx, cfg)
	if err != nil {
		slog.Error("postgres init failed", "err", err)
		os.Exit(1)
	}
	defer database.Close()
	slog.Info("postgres connected")

	rdb, err := redis.New(ctx, cfg)
	if err != nil {
		slog.Error("redis init failed", "err", err)
		os.Exit(1)
	}
	defer func() { _ = rdb.Close() }()
	slog.Info("redis connected")

	// Stateless wrappers — no I/O until first request.
	verifier := auth.New(cfg.SupabaseURL, cfg.SupabaseSecret)
	tenantSvc := tenant.New(database)
	q := queries.New(database.Pool)

	// asynq producer + consumer. Producer is also passed into the
	// registry so the inbound subscriber can enqueue wa:incoming
	// tasks from the whatsmeow event hot path.
	asynqClient, err := queue.NewClient(cfg.RedisURL)
	if err != nil {
		slog.Error("asynq client init failed", "err", err)
		os.Exit(1)
	}
	defer func() { _ = asynqClient.Close() }()
	slog.Info("asynq client ready")

	asynqServer, err := queue.NewServer(cfg.RedisURL)
	if err != nil {
		slog.Error("asynq server init failed", "err", err)
		os.Exit(1)
	}

	// S3 client for WhatsApp media (JUR-75/76). Optional — if AWS env
	// vars aren't configured (typical for local dev), inbound media
	// gets persisted with media_key=NULL and the UI shows
	// "Media tidak tersedia". Failing boot would be too strict for dev.
	s3Client, s3Err := storage.Default(ctx)
	if s3Err != nil {
		slog.Warn("s3 client unavailable — wa media uploads will be skipped",
			"err", s3Err)
		s3Client = nil
	} else {
		slog.Info("s3 client ready", "bucket", s3Client.Bucket())
	}

	// whatsmeow registry. Stores SQLite session files under ./data/
	// (relative to the api's working directory — the systemd unit
	// sets WorkingDirectory accordingly). Needs redis (for dedupe
	// SETs) and asynq (for inbound enqueue) for the inbound
	// subscriber wired in JUR-68. S3 client (optional) drives media
	// upload from JUR-75 onwards.
	registry := whatsapp.NewRegistry(q, rdb.Client, asynqClient.Client, "data", s3Client)

	// AI provider registry — adapters are only functional if their key is
	// configured; boot succeeds regardless (lazy validation at first call).
	providers := []ai.AiProvider{
		ai.NewOpenAI(cfg.OpenAIKey),
		ai.NewGemini(cfg.GeminiKey),
	}
	usageRecorder := ai.NewUsageRecorder(q)
	aiSvc := ai.New(providers, usageRecorder)
	convLoader := conversation.New(q)

	// WhatsApp send rate limiter — Redis-backed token bucket. Caps
	// per-instance and per-recipient send rate to avoid bans. The
	// limiter is constructed once and shared across all wa:send tasks.
	rateLimiter := ratelimit.NewLimiter(rdb.Client, ratelimit.Config{
		PerInstancePerSec: cfg.WaRatePerInstancePerSec,
		PerJIDPerSec:      cfg.WaRatePerJIDPerSec,
		BucketCapacity:    cfg.WaRateBucketCapacity,
		MaxWait:           time.Duration(cfg.WaRateMaxWaitMs) * time.Millisecond,
		PollInterval:      50 * time.Millisecond,
	})

	// Staff WhatsApp OTP login service. Reused by:
	//   - wa:incoming hook (intercepts "minta otp login" pattern)
	//   - /v1/auth/wa-login/* HTTP endpoints
	// Both limiters are INDEPENDENT of the wa:send token bucket —
	// they gate request/guess bursts at the source phone (anti-abuse),
	// not delivery rate.
	waLoginReqLimiter := walogin.NewRequestLimiter(rdb.Client, "walogin:req", 3, time.Hour)
	waLoginVerifyLimiter := walogin.NewRequestLimiter(rdb.Client, "walogin:verify", 5, time.Hour)
	waLoginSvc := walogin.NewService(q, asynqClient.Client, waLoginReqLimiter, waLoginVerifyLimiter)

	// Register task handlers BEFORE asynqServer.Run().
	queuetasks.RegisterWASend(asynqServer.Mux(), &queuetasks.WASendHandler{
		Q:         q,
		Registry:  registry,
		RateLimit: rateLimiter,
	})
	queuetasks.RegisterWASendImage(asynqServer.Mux(), &queuetasks.WASendImageHandler{
		Q:         q,
		Registry:  registry,
		S3:        s3Client,
		RateLimit: rateLimiter,
	})
	queuetasks.RegisterWAIncoming(asynqServer.Mux(), &queuetasks.WAIncomingHandler{
		Q:           q,
		AsynqClient: asynqClient.Client,
		WALogin:     waLoginSvc,
	})
	queuetasks.RegisterWAReaction(asynqServer.Mux(), &queuetasks.WAReactionHandler{
		Q: q,
	})
	queuetasks.RegisterWALidBackfill(asynqServer.Mux(), &queuetasks.WALidBackfillHandler{
		Q:  q,
		DB: database.Pool,
	})
	queuetasks.RegisterAIReply(asynqServer.Mux(), &queuetasks.AIReplyHandler{
		Q:           q,
		DB:          database.Pool,
		Redis:       rdb.Client,
		AsynqClient: asynqClient.Client,
		AiSvc:       aiSvc,
		Loader:      convLoader,
	})

	// Boot-time cleanup for the wa_login_otps table. Deletes consumed
	// or expired rows older than 30 days. Runs as a fire-and-forget
	// goroutine wrapped in safego so a slow Postgres round-trip doesn't
	// delay the listener coming up — and a panic (e.g. malformed query
	// after a future migration) doesn't crash the process.
	//
	// 30-day retention is plenty: the verify-success slog line is the
	// durable audit record, and the OTP rows are useless once consumed.
	// Scheduling is "runs on every restart" which is good enough for a
	// table that grows ~10s of rows per tenant per day.
	safego.Go("walogin.cleanup", func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		n, err := q.DeleteStaleWaLoginOtps(cleanupCtx)
		if err != nil {
			slog.Warn("wa-login cleanup failed", "err", err)
			return
		}
		if n > 0 {
			slog.Info("wa-login cleanup: removed stale otps", "count", n)
		}
	})

	// Revive any instances that were live before the last shutdown.
	// Fire-and-forget so a slow Supabase round-trip doesn't delay
	// the listener coming up. Wrapped in safego so a panic during
	// revive (e.g. malformed wa_instances row, whatsmeow store error)
	// doesn't crash the process during startup.
	safego.Go("registry.revive", func() {
		reviveCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		registry.Revive(reviveCtx)
	})

	app := httpserver.NewServer(httpserver.Deps{
		Config:      cfg,
		Verifier:    verifier,
		Tenant:      tenantSvc,
		Queries:     q,
		DBPool:      database.Pool,
		Registry:    registry,
		AsynqClient: asynqClient,
		Redis:       rdb.Client, // raw goredis.Client for /readyz + future rate-limit middleware
		AppVersion:  appVersion,
		S3:          s3Client,
		WaLogin:     waLoginSvc,
	})

	addr := ":" + strconv.Itoa(cfg.Port)

	// Background goroutines wrapped in safego so a panic anywhere here
	// (e.g. an asynq middleware bug, a Fiber listener crash on a port
	// conflict surfacing as a goroutine panic) is logged and recovered
	// instead of taking the whole process down.
	safego.Go("asynq.run", func() {
		slog.Info("asynq server starting")
		if err := asynqServer.Run(); err != nil {
			slog.Error("asynq run failed", "err", err)
			stop()
		}
	})

	safego.Go("http.listen", func() {
		slog.Info("api listening", "addr", addr, "prefix", "/v1", "env", cfg.NodeEnv)
		if err := app.Listen(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("listen failed", "err", err)
			stop()
		}
	})

	<-ctx.Done()
	slog.Info("shutdown requested, draining...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Shutdown order:
	//   1. HTTP — stop accepting new requests.
	//   2. asynq — stop pulling new tasks; in-flight handlers drain.
	//   3. registry — close whatsmeow sockets cleanly.
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		slog.Error("http shutdown error", "err", err)
	}
	asynqServer.Shutdown()
	if err := registry.Shutdown(shutdownCtx); err != nil {
		slog.Error("registry shutdown error", "err", err)
	}
	slog.Info("api stopped")
}

func setupLogger(level, env string) {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}

	var handler slog.Handler
	if env == "production" {
		handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: lvl})
	} else {
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: lvl})
	}
	slog.SetDefault(slog.New(handler))
}
