package whatsapp

import (
	"testing"
	"time"
)

func TestNextDelay_GrowsExponentiallyThenCaps(t *testing.T) {
	cases := []struct {
		attempt int
		min     time.Duration
		max     time.Duration
	}{
		{0, 1 * time.Second, 2 * time.Second},
		{1, 2 * time.Second, 3 * time.Second},
		{2, 4 * time.Second, 5 * time.Second},
		{3, 8 * time.Second, 9 * time.Second},
		{4, 16 * time.Second, 17 * time.Second},
		{5, 32 * time.Second, 33 * time.Second},
		{6, 60 * time.Second, 61 * time.Second}, // capped here
		{7, 60 * time.Second, 61 * time.Second},
		{50, 60 * time.Second, 61 * time.Second}, // sanity: huge values still cap
	}

	for _, tc := range cases {
		d := NextDelay(tc.attempt)
		if d < tc.min || d > tc.max {
			t.Errorf("attempt=%d: delay=%v out of range [%v, %v]", tc.attempt, d, tc.min, tc.max)
		}
	}
}

func TestNextDelay_NegativeClampedToZero(t *testing.T) {
	// Defensive — caller shouldn't pass negatives but we shouldn't
	// crash if they do.
	d := NextDelay(-5)
	if d < 1*time.Second || d > 2*time.Second {
		t.Errorf("negative attempt should clamp to 0; got %v", d)
	}
}

func TestNextDelay_JitterIsRandom(t *testing.T) {
	// With 1000ms of jitter spread across many calls, we should see
	// some variation. Not a strict distribution test — just confirms
	// jitter is actually applied (vs. always 0ms).
	seen := map[time.Duration]struct{}{}
	for i := 0; i < 50; i++ {
		seen[NextDelay(2)] = struct{}{}
	}
	if len(seen) < 5 {
		t.Errorf("50 calls at attempt=2 produced only %d distinct delays — jitter not working?", len(seen))
	}
}

func TestMaxReconnectAttempts_TotalBudget(t *testing.T) {
	// Sanity-check that the total wait budget is roughly what the
	// comment in disconnect.go claims (~3 minutes). Run with the
	// MIN of each step (excludes jitter) for stability.
	var total time.Duration
	for i := 0; i < MaxReconnectAttempts; i++ {
		// Use min by subtracting up-to-1s jitter ceiling.
		d := NextDelay(i) - 1*time.Second
		if d < 0 {
			d = 0
		}
		total += d
	}
	// Floor: 1+2+4+8+16+32+60+60 = 183s. Allow some slop for jitter rounding.
	if total < 170*time.Second {
		t.Errorf("MaxReconnectAttempts budget = %v, expected ~180s minimum", total)
	}
	if total > 200*time.Second {
		t.Errorf("MaxReconnectAttempts budget = %v, exceeded reasonable ceiling", total)
	}
}
