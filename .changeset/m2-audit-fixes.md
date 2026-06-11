---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix M2 issues caught in audit of JUR-25 → JUR-31:

- **BullMQ queue names** (JUR-29): rename `wa:send` / `wa:incoming` / `ai:reply` → `wa-send` / `wa-incoming` / `ai-reply`. BullMQ rejects names containing `:` because Redis uses that as its key separator; original spec & implementation crashed at boot with "Queue name cannot contain :".
- **Baileys QR rendering** (JUR-26): the connection handler was wrapping the raw Baileys pairing payload string (e.g. `2@xxx,yyy,...`) in a `data:image/png;base64,` prefix. That payload isn't a PNG — the resulting data URL rendered as a broken image in the browser. Now uses the `qrcode` lib to actually generate a 256×256 PNG data URL.
- **Baileys cleanup** (JUR-26): `socket.ev.removeAllListeners()` requires an event key on Baileys' typed emitter. Explicitly drop the three listeners we attached (`creds.update`, `connection.update`, `messages.upsert`).
- **Final-failure detection** (JUR-29): replaced `override async onFailed(...)` (a no-op — `WorkerHost` doesn't expose that hook) with `@OnWorkerEvent('failed')`, gated on `attemptsMade >= job.opts.attempts` so we only mark messages `failed` after all retries are exhausted.
- **Web typecheck** (JUR-31): missing `Warehouse` icon import in `lib/constants.ts`, `Dialog` was called with `onOpenChange` (it expects `onClose`), `ConfirmDialog` was called with `confirmLabel` (it expects `confirmText`) — corrected all three and added `variant="danger"` on the delete confirmation since it's a destructive action.

End-to-end smoke verified: api boots cleanly, all 11 routes mapped, `/v1/wa/instances` returns 401 without auth.
