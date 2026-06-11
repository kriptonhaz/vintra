---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

whatsmeow provider with SQLite session store + typed events (JUR-64, M2).

The core WhatsApp gateway. Pure-Go all the way down — `go.mau.fi/whatsmeow` for the protocol, `modernc.org/sqlite` for the session store (so `CGO_ENABLED=0` static builds keep working), `skip2/go-qrcode` to render the pairing payload as a PNG data URL.

- **`internal/whatsapp/store.go`** — `Store` wraps `*sqlstore.Container`. Opens `data/whatsmeow.db` with WAL + foreign keys via modernc's URI-PRAGMA syntax. Auto-creates the parent directory. Includes a thin slog↔whatsmeow log bridge so whatsmeow's internal logs flow into our structured slog output with a configurable verbosity floor.
- **`internal/whatsapp/provider.go`** — `Connection` wraps `*whatsmeow.Client` per instance with sync-safe `Status()`, a Subscribe/emit fanout for typed events, and `SendText(ctx, jid, body) (externalID, error)`. `Connect(ctx)` branches on `Client.Store.ID == nil`: fresh devices spin up the QR channel goroutine; pre-paired devices just resume from SQLite without a QR. `handleWAEvent` translates whatsmeow's raw event vocabulary into our 6-variant `Event` interface, including treating `StreamReplaced` as logout. Hot-path discipline preserved — handlers only emit events; persistence happens downstream (JUR-66/JUR-68).
- **`internal/whatsapp/events.go`** — Typed event sum (`QREvent`, `ConnectedEvent`, `DisconnectedEvent`, `LoggedOutEvent`, `GiveUpEvent`, `MessageEvent`). Narrow surface (~6 kinds) easier to mock than whatsmeow's full event vocab. QR events carry both the raw `Code` and a pre-rendered `DataURL` so subscribers don't need their own QR library.
- **`internal/whatsapp/qrcode.go`** — Renders whatsmeow's pairing string to `data:image/png;base64,...` via `skip2/go-qrcode`. Medium error correction, 256×256.
- **Tests** — 5 new (qrcode round-trip + PNG magic check, qrcode empty input rejection, store directory creation, store reopen idempotency, nil-safe Close).

Acceptance criteria 2–5 (real phone scan, status flip, sqlite row, restart-revive, send text) are gated on JUR-32 manual e2e — requires hardware.
