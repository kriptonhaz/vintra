---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-141 / JUR-143 PR 2 — Peti Kas cashier UI:

Five new components under `apps/web/src/components/pos/cash/`:

- **`<BukaKasModal>`** — blocking dialog when no open session exists. CurrencyInput for opening balance + optional notes textarea. No "Batal" button on purpose (alternative is signing out).
- **`<KasHeaderChip>`** — pill in the `/pos/cashier` header showing live running balance (`opening + cash_in − cash_out`). Click opens a ⋮ menu with Setor Tunai / Tarik Tunai / Tutup Kas. Outside-click dismiss.
- **`<SetorTarikModal>`** — symmetric drop/payout entry. Same shape (amount + reason); `kind` prop picks the title/CTA strings and which server fn (`recordCashDrop` vs `recordCashPayout`).
- **`<TutupKasModal>`** — close-out reconciliation. Loads `getCashSessionDetail` to compute the rekap live (so it picks up movements made in concurrent tabs). Live variance preview as the cashier types the physical count. When `|variance| ≥ varianceThreshold`, the row turns red, an `AlertTriangle` shows, and the closing-notes field becomes required.
- **`<StaleSessionModal>`** — blocking modal when `getCurrentOpenSession` returns a session opened >14h ago. Single "Force Close & Start New Session" CTA records variance with `force_closed=true` and an auto-generated note.

`/pos/cashier` wiring:

- New `cashSessionQuery` polls every 30s when the drawer is enabled.
- Header conditionally renders `<KasHeaderChip>` when a session is open and drawer is enabled.
- `<BukaKasModal>` renders over the page when drawer is enabled AND no session exists.
- `<StaleSessionModal>` wins when there's an open session opened more than 14h ago.
- `createSale.onError` matches the literal `'Buka Kas dulu sebelum jualan tunai.'` from PR 1 and fires a toast + refetches the session — defensive race-safety in case the cashier's local state lagged.
- `varianceThreshold` and `cashDrawer.enabled` flow from the existing `getPOSCashierMasters.cashDrawer` block added in PR 1.

i18n: new `pos.cash` namespace with id + en strings for every visible bit of copy, following the JUR-138 glossary (Kasir → Cashier, etc).

**Backward-compat**: nothing renders for tenants with `cash_drawer_enabled = false` (the safe default from PR 1). Existing cashier UX is unchanged until PR 4 flips the flag on for Komplit tenants.
