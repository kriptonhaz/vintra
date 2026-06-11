package ratelimit

import (
	"context"
	"os"
	"testing"
	"time"

	goredis "github.com/redis/go-redis/v9"
)

// newTestLimiter dials the Redis at REDIS_URL (or localhost) and skips
// the test if Redis isn't reachable. Token-bucket logic depends on Lua
// + atomic Redis ops, so a real Redis is the only honest fixture.
func newTestLimiter(t *testing.T, cfg Config) (*Limiter, *goredis.Client, func()) {
	t.Helper()
	url := os.Getenv("REDIS_URL")
	if url == "" {
		url = "redis://127.0.0.1:6379/1"
	}
	opts, err := goredis.ParseURL(url)
	if err != nil {
		t.Skipf("REDIS_URL parse failed: %v", err)
	}
	rdb := goredis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("redis unreachable, skipping: %v", err)
	}
	// Each test runs against a unique key prefix so concurrent test
	// runs don't poison each other.
	cleanup := func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		// Best-effort cleanup of any keys this test wrote.
		keys, _ := rdb.Keys(ctx, "bucket:wa:*").Result()
		for _, k := range keys {
			_ = rdb.Del(ctx, k).Err()
		}
		_ = rdb.Close()
	}
	return NewLimiter(rdb, cfg), rdb, cleanup
}

// TestAcquire_PerJIDThrottle: with PerJIDPerSec=2, the third acquire
// in quick succession to the same JID should incur a wait (because
// burst capacity = 2 lets 2 through immediately).
func TestAcquire_PerJIDThrottle(t *testing.T) {
	cfg := Config{
		PerInstancePerSec: 100, // effectively unlimited at instance level
		PerJIDPerSec:      2,
		BucketCapacity:    2,
		MaxWait:           3 * time.Second,
		PollInterval:      20 * time.Millisecond,
	}
	lim, _, cleanup := newTestLimiter(t, cfg)
	defer cleanup()

	ctx := context.Background()
	const inst, jid = "test-inst-throttle", "628999111@s.whatsapp.net"

	// First two acquires should succeed immediately (burst capacity).
	start := time.Now()
	for i := 0; i < 2; i++ {
		if err := lim.Acquire(ctx, inst, jid); err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
	}
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Errorf("first 2 acquires took %v, expected near-instant", elapsed)
	}

	// Third acquire should wait roughly 500ms (1 token / 2 tokens-per-sec).
	start = time.Now()
	if err := lim.Acquire(ctx, inst, jid); err != nil {
		t.Fatalf("third acquire: %v", err)
	}
	elapsed := time.Since(start)
	if elapsed < 300*time.Millisecond || elapsed > 800*time.Millisecond {
		t.Errorf("third acquire wait = %v, expected ~500ms", elapsed)
	}
}

// TestAcquire_MaxWaitExceeded: with PerJIDPerSec=0.1 (one token every
// 10s) and MaxWait=200ms, the second acquire must return ErrRateLimited.
func TestAcquire_MaxWaitExceeded(t *testing.T) {
	cfg := Config{
		PerInstancePerSec: 100,
		PerJIDPerSec:      0.1,
		BucketCapacity:    1,
		MaxWait:           200 * time.Millisecond,
		PollInterval:      20 * time.Millisecond,
	}
	lim, _, cleanup := newTestLimiter(t, cfg)
	defer cleanup()

	ctx := context.Background()
	const inst, jid = "test-inst-maxwait", "628999222@s.whatsapp.net"

	if err := lim.Acquire(ctx, inst, jid); err != nil {
		t.Fatalf("first acquire: %v", err)
	}
	err := lim.Acquire(ctx, inst, jid)
	if err == nil {
		t.Fatal("expected ErrRateLimited, got nil")
	}
}

// TestAcquire_DifferentJIDsIndependent: per-JID buckets must not
// throttle each other. After consuming JID A's burst, JID B should
// still be unthrottled.
func TestAcquire_DifferentJIDsIndependent(t *testing.T) {
	cfg := Config{
		PerInstancePerSec: 100,
		PerJIDPerSec:      1,
		BucketCapacity:    1,
		MaxWait:           500 * time.Millisecond,
		PollInterval:      20 * time.Millisecond,
	}
	lim, _, cleanup := newTestLimiter(t, cfg)
	defer cleanup()

	ctx := context.Background()
	const inst = "test-inst-multijid"

	if err := lim.Acquire(ctx, inst, "628111@s.whatsapp.net"); err != nil {
		t.Fatalf("acquire JID A: %v", err)
	}
	// Different JID — should not be throttled by A's bucket.
	start := time.Now()
	if err := lim.Acquire(ctx, inst, "628222@s.whatsapp.net"); err != nil {
		t.Fatalf("acquire JID B: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Errorf("JID B acquire took %v, expected near-instant", elapsed)
	}
}

// TestAcquire_DisabledBucket: rate=0 should disable that bucket
// entirely (no throttling). Useful for testing or per-tier overrides.
func TestAcquire_DisabledBucket(t *testing.T) {
	cfg := Config{
		PerInstancePerSec: 0, // disabled
		PerJIDPerSec:      1000,
		BucketCapacity:    5,
		MaxWait:           500 * time.Millisecond,
		PollInterval:      20 * time.Millisecond,
	}
	lim, _, cleanup := newTestLimiter(t, cfg)
	defer cleanup()

	ctx := context.Background()
	const inst, jid = "test-inst-disabled", "628999333@s.whatsapp.net"

	// 10 rapid acquires should all succeed (per-JID rate is high enough
	// that each fits in burst window) since instance is disabled.
	start := time.Now()
	for i := 0; i < 10; i++ {
		if err := lim.Acquire(ctx, inst, jid); err != nil {
			t.Fatalf("acquire %d: %v", i, err)
		}
	}
	if elapsed := time.Since(start); elapsed > 200*time.Millisecond {
		t.Errorf("10 acquires took %v with instance disabled, expected fast", elapsed)
	}
}
