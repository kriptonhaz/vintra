// Package redis opens and owns the Redis client for the api.
//
// Single shared client across the process. Redis is used for:
//   - asynq queues (JUR-67, JUR-68)
//   - per-(instance,jid) AI reply locks (JUR-38)
//   - inbound dedupe SETs (JUR-68)
//   - rate-limit token buckets (JUR-43)
//
// whatsmeow's WhatsApp session store is SQLite — NOT here.
package redis

import (
	"context"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"

	"github.com/kriptonhaz/vintra/apps/api/internal/config"
)

// Client wraps *goredis.Client. The embedded interface gives downstream
// packages the full go-redis API surface (SetNX for locks, SAdd for
// dedupe, etc.) without an abstraction layer.
type Client struct {
	*goredis.Client
}

// New parses REDIS_URL (redis://[:pass@]host:port[/db]) and opens a
// connection. Pings to verify reachability before returning — same
// boot-time fail-fast guarantee as pgx.
func New(ctx context.Context, cfg *config.Config) (*Client, error) {
	opts, err := goredis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}

	rc := goredis.NewClient(opts)

	pingCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := rc.Ping(pingCtx).Err(); err != nil {
		_ = rc.Close()
		return nil, fmt.Errorf("ping redis: %w", err)
	}

	return &Client{Client: rc}, nil
}

// Ping checks Redis is reachable. Used by the future /readyz handler
// (JUR-41).
func (c *Client) Ping(ctx context.Context) error {
	return c.Client.Ping(ctx).Err()
}

// Close drains the client. Safe to call multiple times.
func (c *Client) Close() error {
	return c.Client.Close()
}
