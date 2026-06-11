---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

POS Peti Kas: configurable stale-session threshold (#216).

The cashier "Sesi Kas Belum Ditutup" force-close prompt was hardcoded to
fire once a session had been open more than 14 hours. For an outlet that
runs ~08:00–22:00 that tripped at natural closing time every day,
producing a phantom full-balance variance flagged as `force_closed`.

The rule is now configurable per tenant, with an optional per-branch
override:

- `elapsed_hours` — stale after N hours (the previous behavior; default
  stays `14h` so nothing changes on deploy).
- `daily_cutoff` — stale once the local clock crosses a daily boundary
  (e.g. `01:00`) and the session was opened before it, i.e. it carried
  into a new business day. An optional `minHours` guard suppresses the
  flag for sessions opened just before the cutoff.

Data model (migration `0124_pos_cash_stale_config`):
- `pos_settings.cash_stale_config` (jsonb, NOT NULL, tenant default —
  defaults to `{"mode":"elapsed_hours","hours":14}`).
- `branches.cash_stale_config` (jsonb, nullable — `NULL` inherits the
  tenant default).

`getCurrentOpenSession` resolves `branch ?? tenant` config and computes
`isStale` via a new pure, unit-tested helper
(`apps/web/src/server/lib/cash-stale.ts`); the cashier UI and
`StaleSessionModal` are unchanged since the response shape is the same.
A "Sesi Kas Kedaluwarsa" section in POS settings edits the tenant
default. Timezone is fixed-WIB for now (multi-tz tracked in #217).

The force-close path (zero-count) is intentionally unchanged — with a
correct boundary it now only fires when a session genuinely carried
overnight, where a stale physical count can't be trusted anyway.
