// Package db opens and owns the Postgres connection pool for the api.
//
// We use pgx/v5 + pgxpool. The Supabase pooler runs in transaction
// mode (port 6543) which doesn't support PostgreSQL prepared
// statements — we force `QueryExecModeExec` so pgx sends unnamed
// prepared statements per call instead of caching named ones.
//
// `prepare: false` in TS land (drizzle-orm + postgres-js) is the
// equivalent setting. Same constraint, different surface.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kriptonhaz/vintra/apps/api/internal/config"
)

// DB wraps *pgxpool.Pool. We expose the embedded pool directly so
// downstream packages can use pgx.Tx, Query, Exec, etc. without an
// abstraction layer — sqlc-generated code in particular wants the
// raw pool interface.
type DB struct {
	*pgxpool.Pool
}

// New opens the connection pool and verifies it with a ping.
// Returns an error if the URL is malformed or the database is
// unreachable. Caller (main.go) is expected to log + exit on error.
func New(ctx context.Context, cfg *config.Config) (*DB, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}

	// Supabase transaction-mode pooler doesn't support PostgreSQL
	// prepared statements. QueryExecModeExec uses unnamed prepared
	// statements per call — works around the limitation.
	// See: https://github.com/jackc/pgx/wiki/Getting-started-with-pgx#using-pgx-with-pgbouncer
	poolCfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeExec

	// Modest pool size — most of our queries are quick (instance
	// lookup, message insert). Adjust upward once JUR-44 (conversation
	// list) and friends are profiled.
	poolCfg.MaxConns = 10
	poolCfg.MinConns = 2
	poolCfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("open pgx pool: %w", err)
	}

	// Verify reachability now rather than on first query — surfaces
	// misconfigured DATABASE_URL at boot, not under traffic.
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	return &DB{Pool: pool}, nil
}

// Ping checks the DB is reachable. Used by the future /readyz handler
// (JUR-41).
func (d *DB) Ping(ctx context.Context) error {
	return d.Pool.Ping(ctx)
}

// Close drains the pool. Idempotent — safe to call multiple times.
func (d *DB) Close() {
	d.Pool.Close()
}
