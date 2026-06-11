---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Disconnect policy + exponential backoff reconnect (JUR-65, M2).

- **`internal/whatsapp/disconnect.go`** — `NextDelay(attempt)` returns 1s/2s/4s/8s/16s/32s/60s/60s + 0–1000ms jitter for attempts 0–7. `MaxReconnectAttempts = 8` gives ~3 min total budget — longer than a wifi blip, shorter than waiting for an alert. Defensive clamps: negative attempts → 0, attempts > 30 → cap (defends against fuzzers / overflow).
- **`internal/whatsapp/provider.go`** — Connection gains `reconnectMu`, `reconnectAttempt`, `reconnectTimer`, `closed`. New `scheduleReconnect()` bumps the counter, schedules via `time.AfterFunc`, emits `GiveUpEvent` when the cap is hit. `runReconnect()` re-checks `closed` under lock (Disconnect may have raced the timer), calls `Client.Connect()`, recurses on error.
- whatsmeow's built-in auto-reconnect is now **disabled** (`Client.EnableAutoReconnect = false`) — we own the retry policy so we can surface `GiveUpEvent` and stop hammering after sustained failures.
- `*events.Connected` handler resets the counter to 0 so the next blip starts fresh.
- `*events.Disconnected` handler now emits `DisconnectedEvent` AND calls `scheduleReconnect()`. Registry consumers should map `DisconnectedEvent` → `status='connecting'` (we're retrying), `GiveUpEvent` → `status='disconnected'` (we stopped), `LoggedOutEvent` → `status='logged_out'` (permanent).
- `Disconnect()` sets `closed=true` under the reconnect mu before tearing down so any in-flight reconnect timer no-ops.

Tests (4 new):
- `NextDelay` produces the expected growth curve + 60s cap
- Negative attempt clamps to 0 (no panic)
- Jitter produces ≥5 distinct delays across 50 calls at attempt=2 (smoke that jitter isn't always 0)
- Total budget across `MaxReconnectAttempts` lands in 170–200s

Real-phone verification gated on JUR-32.
