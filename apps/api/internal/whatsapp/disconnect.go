package whatsapp

import (
	"math/rand"
	"time"
)

// MaxReconnectAttempts caps the reconnect chain. After this many
// consecutive failures the Connection emits GiveUpEvent and stops
// retrying. The user has to explicitly re-pair or restart the api.
//
// 8 attempts with exponential backoff covers:
//   1+2+4+8+16+32+60+60 ≈ 3 minutes of retrying.
// Longer than a typical wifi blip, shorter than waiting for an
// operator to look at the alert.
const MaxReconnectAttempts = 8

// NextDelay returns the wait duration before reconnect attempt N
// (0-indexed). Exponential backoff with jitter, capped at 60s.
//
//   attempt 0 → ~1s    (network blip — recover fast)
//   attempt 1 → ~2s
//   attempt 2 → ~4s
//   attempt 3 → ~8s
//   attempt 4 → ~16s
//   attempt 5 → ~32s
//   attempt 6+ → ~60s  (server-side outage — back off)
//
// Jitter is 0..1000ms uniform — keeps reconnect storms across many
// tenants from re-hammering WhatsApp at the same wall-clock moment.
func NextDelay(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	// Cap the shift to avoid overflow on huge attempt values
	// (defensive — the caller stops at MaxReconnectAttempts, but
	// fuzzers / tests might pass anything).
	if attempt > 30 {
		attempt = 30
	}
	base := time.Duration(1<<uint(attempt)) * time.Second
	if base > 60*time.Second {
		base = 60 * time.Second
	}
	jitter := time.Duration(rand.Intn(1000)) * time.Millisecond
	return base + jitter
}
