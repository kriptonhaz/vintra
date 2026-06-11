package walogin

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// ErrRateLimited is returned by Allow when the caller has exceeded
// the per-phone OTP-request budget. The detector swallows this and
// silently drops the message — telling the user "rate limited" via WA
// reply would leak intelligence to an attacker who is enumerating
// phones.
var ErrRateLimited = errors.New("walogin: rate limited")

// RequestLimiter caps how many actions (OTP requests OR OTP verifies,
// depending on which limiter the caller holds) a single phone can
// trigger inside a rolling window. Deliberately separate from the
// existing wa:send token bucket (apps/api/internal/ratelimit):
//
//   - This limits per-phone bursts AT THE SOURCE (an attacker
//     spamming inbound, or scripting verify guesses).
//   - The wa:send bucket limits SEND volume from the instance.
//
// Both fire on every OTP — they serve different threats.
//
// Implementation is a simple fixed-window counter in Redis (INCR + the
// EXPIRE-on-first-hit trick). Not the most sophisticated algorithm, but
// the abuse pattern here is "one phone, many requests in a minute" —
// fixed windows catch that cleanly with minimal Redis traffic.
//
// keyPrefix lets one process hold multiple limiters that don't
// collide. Use "walogin:req" for request-side, "walogin:verify" for
// verify-side; pick something namespace-distinct if you wire more.
type RequestLimiter struct {
	redis     *goredis.Client
	keyPrefix string
	max       int           // max requests per window
	window    time.Duration // window size
}

// NewRequestLimiter builds a limiter capping `max` requests per `window`
// per (tenant, phone). keyPrefix MUST be unique per logical bucket —
// otherwise two limiters share state and burn each other's budget.
func NewRequestLimiter(redis *goredis.Client, keyPrefix string, max int, window time.Duration) *RequestLimiter {
	return &RequestLimiter{
		redis:     redis,
		keyPrefix: keyPrefix,
		max:       max,
		window:    window,
	}
}

// Allow records an attempt against the (tenant, phone) bucket and
// returns nil if it fits inside the budget. ErrRateLimited otherwise.
// Other errors are Redis failures — caller should treat them as
// "allow" (fail-open) to avoid locking users out during a Redis
// blip, but log loudly.
func (l *RequestLimiter) Allow(ctx context.Context, tenantID, phone string) error {
	key := fmt.Sprintf("%s:%s:%s", l.keyPrefix, tenantID, phone)
	// INCR returns the new value. If this is the first hit, follow up
	// with EXPIRE — subsequent hits in the same window inherit the TTL.
	n, err := l.redis.Incr(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("walogin ratelimit incr: %w", err)
	}
	if n == 1 {
		if err := l.redis.Expire(ctx, key, l.window).Err(); err != nil {
			// Don't fail the request — the counter still works, the
			// key just won't auto-expire. Log loudly so we notice.
			return fmt.Errorf("walogin ratelimit expire: %w", err)
		}
	}
	if n > int64(l.max) {
		return ErrRateLimited
	}
	return nil
}

// MustParseInt is a small helper for the Redis HGET-style returns —
// kept here in case service.go needs to inspect bucket state for
// metrics in PR 7. Wrapped to return 0 instead of panicking on bad
// input; callers can treat 0 as "no record yet".
func MustParseInt(s string) int64 {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}
