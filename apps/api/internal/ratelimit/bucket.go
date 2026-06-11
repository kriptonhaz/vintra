// Package ratelimit implements a Redis-backed token bucket. The wa:send
// worker calls Acquire() before every SendMessage so we never exceed
// WhatsApp's per-recipient or per-account send rate.
//
// Why this matters: WhatsApp bans accounts that spam — and a ban is
// permanent and irrecoverable on that number. The risk shape is
// asymmetric (one bug burst → one tenant's number permanently dead),
// so we throttle conservatively.
//
// Two-level throttling per send:
//
//	bucket:wa:inst:{instanceId}        — caps account-wide send rate
//	bucket:wa:jid:{instanceId}:{jid}   — caps per-recipient send rate
//
// Both must allow the send. If either is empty, the worker blocks
// (with a hard ceiling of MaxWait) until both refill enough.
//
// The token-bucket math runs server-side in Redis via Lua so concurrent
// workers can't double-spend the same token.
package ratelimit

import (
	"context"
	"errors"
	"fmt"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// Limiter throttles sends through Redis-backed token buckets. Constructed
// once at boot; method calls are safe for concurrent use.
type Limiter struct {
	redis *goredis.Client
	cfg   Config
	// acquire is the precomputed Lua script handle. Redis caches it by
	// SHA on first call so subsequent calls are EVALSHA, not EVAL.
	acquire *goredis.Script
}

// Config holds all tunables — set from env at boot. Defaults are
// conservative; bump per-instance rate up only after observing how WA
// reacts in production.
type Config struct {
	// PerInstancePerSec is the max sends-per-second across all recipients
	// for a single wa_instance. Whole-account throttle.
	PerInstancePerSec float64
	// PerJIDPerSec is the max sends-per-second to a single recipient
	// from a given instance. Per-recipient throttle.
	PerJIDPerSec float64
	// BucketCapacity is the burst size for both buckets. A capacity of
	// `rate * 1` means up to one second of bursts is allowed before
	// rate-limiting kicks in. Keep small so bursts don't trigger
	// ban-detection on WhatsApp's side.
	BucketCapacity int
	// MaxWait is the hardest ceiling on how long Acquire will block.
	// Beyond this, the caller gets ErrRateLimited and asynq retries
	// the task with its own backoff (better behavior than holding a
	// goroutine for minutes waiting on the bucket).
	MaxWait time.Duration
	// PollInterval is how often Acquire re-checks the bucket while
	// waiting. Trade-off: shorter = lower latency under contention,
	// higher = less Redis load. 50ms is a fine middle ground.
	PollInterval time.Duration
}

// DefaultConfig returns the conservative production-safe defaults.
// Override per-field via env when tuning.
func DefaultConfig() Config {
	return Config{
		PerInstancePerSec: 10,
		PerJIDPerSec:      1,
		BucketCapacity:    5,
		MaxWait:           5 * time.Second,
		PollInterval:      50 * time.Millisecond,
	}
}

// ErrRateLimited is returned when Acquire couldn't get a token within
// the MaxWait budget. Caller should propagate; asynq retries with its
// own backoff.
var ErrRateLimited = errors.New("ratelimit: max wait exceeded")

// NewLimiter wires up the Redis script and returns a usable Limiter.
func NewLimiter(redis *goredis.Client, cfg Config) *Limiter {
	return &Limiter{
		redis:   redis,
		cfg:     cfg,
		acquire: goredis.NewScript(acquireScript),
	}
}

// Acquire blocks until both buckets (per-instance + per-JID) have a
// token, then returns nil. Returns ErrRateLimited if MaxWait is
// exceeded. Returns wrapped error for any Redis failure (caller should
// retry on those).
//
// Note: this can block the calling goroutine for up to MaxWait. Always
// call from worker tasks, never from HTTP handlers.
func (l *Limiter) Acquire(ctx context.Context, instanceID, jid string) error {
	deadline := time.Now().Add(l.cfg.MaxWait)
	instKey := fmt.Sprintf("bucket:wa:inst:%s", instanceID)
	jidKey := fmt.Sprintf("bucket:wa:jid:%s:%s", instanceID, jid)

	for {
		waitMs, err := l.tryAcquireBoth(ctx, instKey, jidKey)
		if err != nil {
			return fmt.Errorf("ratelimit: %w", err)
		}
		if waitMs == 0 {
			return nil // both buckets had tokens, both consumed atomically
		}

		// One or both buckets needs to refill. Sleep up to PollInterval,
		// respecting deadline + ctx cancellation.
		wait := time.Duration(waitMs) * time.Millisecond
		if err := l.sleep(ctx, deadline, wait); err != nil {
			return err
		}
	}
}

// tryAcquireBoth atomically checks both buckets via one Lua call.
// Returns 0 if BOTH had a token (both consumed); otherwise returns
// the longer of the two wait times in milliseconds. Critical: we
// never partially consume — either both tokens are taken or neither
// is. That's why the math has to be in Lua, not split across two
// round-trips with refund-on-failure.
func (l *Limiter) tryAcquireBoth(ctx context.Context, instKey, jidKey string) (int64, error) {
	now := time.Now().UnixMilli()
	res, err := l.acquire.Run(
		ctx, l.redis,
		[]string{instKey, jidKey},
		l.cfg.PerInstancePerSec,
		l.cfg.PerJIDPerSec,
		l.cfg.BucketCapacity,
		now,
	).Result()
	if err != nil {
		return 0, err
	}
	waitMs, ok := res.(int64)
	if !ok {
		return 0, fmt.Errorf("unexpected Lua return type: %T", res)
	}
	return waitMs, nil
}

func (l *Limiter) sleep(ctx context.Context, deadline time.Time, wait time.Duration) error {
	if time.Now().Add(wait).After(deadline) {
		return ErrRateLimited
	}
	// Cap each sleep at PollInterval so a long wait still respects
	// cancellation promptly.
	if wait > l.cfg.PollInterval {
		wait = l.cfg.PollInterval
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(wait):
		return nil
	}
}

// acquireScript atomically checks both buckets and consumes a token
// from each ONLY if both have one available. Returns 0 on success,
// or the larger of the two ms-to-wait values otherwise. Critical: it
// never partially consumes — that prevents wasting tokens from the
// looser bucket while the tighter one is still draining.
//
// State per bucket (HSET):
//
//	tokens          float — fractional tokens currently available
//	last_refill_ms  int   — last refill timestamp (ms since epoch)
//
// Args:
//
//	KEYS[1] — instance bucket key
//	KEYS[2] — per-JID bucket key
//	ARGV[1] — per-instance rate (per second)
//	ARGV[2] — per-JID rate (per second)
//	ARGV[3] — bucket capacity (shared)
//	ARGV[4] — now (ms since epoch)
//
// Returns: 0 if both tokens consumed; max(ms-to-wait) otherwise.
const acquireScript = `
local function refill(key, rate, capacity, now)
  if rate <= 0 then return capacity, 0 end  -- disabled bucket: always passes
  local data = redis.call("HMGET", key, "tokens", "last_refill_ms")
  local tokens = tonumber(data[1]) or capacity
  local last = tonumber(data[2]) or now
  local elapsed_sec = (now - last) / 1000.0
  if elapsed_sec < 0 then elapsed_sec = 0 end
  tokens = math.min(capacity, tokens + elapsed_sec * rate)
  return tokens, rate
end

local function timeToOne(tokens, rate)
  if rate <= 0 then return 0 end
  if tokens >= 1 then return 0 end
  return math.ceil(((1 - tokens) / rate) * 1000)
end

local rate_inst = tonumber(ARGV[1])
local rate_jid  = tonumber(ARGV[2])
local capacity  = tonumber(ARGV[3])
local now       = tonumber(ARGV[4])

local inst_tokens, _ = refill(KEYS[1], rate_inst, capacity, now)
local jid_tokens,  _ = refill(KEYS[2], rate_jid,  capacity, now)

local wait_inst = timeToOne(inst_tokens, rate_inst)
local wait_jid  = timeToOne(jid_tokens,  rate_jid)
local wait = math.max(wait_inst, wait_jid)

if wait > 0 then
  -- Don't consume — but still write back the refilled state so the
  -- next Acquire benefits from the elapsed-time accounting.
  if rate_inst > 0 then
    redis.call("HSET", KEYS[1], "tokens", inst_tokens, "last_refill_ms", now)
    redis.call("EXPIRE", KEYS[1], 600)
  end
  if rate_jid > 0 then
    redis.call("HSET", KEYS[2], "tokens", jid_tokens, "last_refill_ms", now)
    redis.call("EXPIRE", KEYS[2], 600)
  end
  return wait
end

-- Both buckets have ≥1 token — consume one from each.
if rate_inst > 0 then
  redis.call("HSET", KEYS[1], "tokens", inst_tokens - 1, "last_refill_ms", now)
  redis.call("EXPIRE", KEYS[1], 600)
end
if rate_jid > 0 then
  redis.call("HSET", KEYS[2], "tokens", jid_tokens - 1, "last_refill_ms", now)
  redis.call("EXPIRE", KEYS[2], 600)
end
return 0
`
