---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add panic-recovery wrappers (`internal/safego`) for whatsmeow event
handlers and background goroutines.

Fiber's `recover` middleware already protects HTTP handlers and asynq
recovers task handlers — the gap was whatsmeow callbacks (event bus)
and our own background goroutines (`registry.Revive`, `asynq.Run`,
`http.Listen`). A panic in any of those would kill the whole api
process and force every connected tenant to rescan their QR code.

The new `safego.Recover`, `safego.Go`, and `safego.RecoverFn` wrappers
log panics with structured slog (label + panic value + stack) and
continue. Wired into:

- `whatsmeow.AddEventHandler` — primary risk: malformed protocol
  events causing nil-pointer derefs in our event parser
- `registry.Revive` background goroutine — startup-only but a panic
  there would crash the process before any tenant could connect
- `asynq.Run` and `http.Listen` goroutines — defensive

Closes JUR-40.
