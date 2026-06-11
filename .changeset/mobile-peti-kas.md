---
"@vintra/web": minor
---

Add Peti Kas (cash session) to the mobile Kasir.

Cashiers on Komplit-tier tenants with the cash drawer enabled can now open a session (modal awal), record manual cash in/out (Setor / Tarik Tunai), and close it (count physical cash → variance, with a force-close option) — directly from the Kasir screen via a status pill. Previously the server required an open session for cash sales but the mobile had no way to open one, so those sales failed.

- Server: new `getActiveCashSession({ branchId })` and the existing `openCashSession` / `recordCashDrop` / `recordCashPayout` / `closeCashSession` are now exposed through the mobile gateway.
- Mobile: `cashDrawer` config surfaced from the masters call; a Peti Kas header pill (Buka Kasir / Peti Kas · Rp <perkiraan>) opening a sheet with open / summary + ledger / setor / tarik / close flows. Checkout already surfaces the "Buka Kas dulu" error gracefully.
- The Z-report is intentionally left off the Kasir screen (stays on web).
