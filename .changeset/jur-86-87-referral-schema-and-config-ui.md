---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": minor
---

JUR-86/87: Referral program schema + admin global config UI.

**DB (JUR-86)**

- New migration `0052_referral_program.sql` (idempotent `IF NOT EXISTS`):
  - `referral_codes` — tenant-owned codes with discount/commission split
  - `referral_attributions` — one-per-referee attribution with window + snapshot
  - `referral_commissions` — per-payment credit events with clawback lifecycle
  - `tenant_payout_methods` — bank transfer payout info per tenant
  - `referral_claim_requests` — admin-processed payout requests
  - `referral_global_config` — single-row global knobs
  - All indexes per spec; `cap_pct numeric(5,2)`; clawback default 14 days
- Drizzle schema `packages/db/src/schema/referrals.ts` with all 5 tables exported

**Admin UI (JUR-87)**

- New server functions `admin-referral-config.ts`:
  - `getReferralConfig` — reads the single config row
  - `updateReferralConfig` — updates with `WHERE id = ...`, writes audit log entry
- New route `/admin/referrals/config`:
  - Form for cap %, window months, clawback days
  - Cap-reduction warning banner (AlertTriangle) when new cap < current cap
  - Last-updated timestamp shown below page title
- Admin sidebar: "Konfigurasi Referral" entry under Modules section
