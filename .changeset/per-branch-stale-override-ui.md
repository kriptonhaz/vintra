---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

POS Peti Kas: per-outlet override UI for the stale cash-session rule
(#216 follow-up).

The "Sesi Kas Kedaluwarsa" editor now has a per-branch scope picker that
mirrors the existing receipt-override UX:

- **Default (semua cabang)** edits the tenant rule — applies to every
  outlet that hasn't overridden, present and future.
- A specific **Cabang** either follows the default (`Ikuti pengaturan
  default`, which clears `branches.cash_stale_config` to NULL) or sets
  its own (`Atur sendiri untuk cabang ini`).

Single-branch tenants never see the picker. New outlets start on inherit
automatically. The tenant-only kill-switch + variance threshold stay in
the separate "Peti Kas" card. Backend (`updateBranchCashStaleConfig`,
the nullable `branches.cash_stale_config` column, and per-branch
resolution in `getCurrentOpenSession`) already shipped — this wires the
form to it; no schema change.
