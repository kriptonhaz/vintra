---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-89: tenant commission dashboard + bank info + claim flow.

- /referrals is now a layout with two tabs (Kode / Komisi). Codes page
  is unchanged content-wise, just moved to /referrals (the index).
- New /referrals/commission page: four stat tiles (Total / Masa Klaim /
  Siap Diklaim / Sudah Dibayar), three sub-tabs (Riwayat Komisi,
  Riwayat Klaim, Info Bank), and a primary "Ajukan Klaim" CTA gated on
  having a claimable balance + a payout method on file.
- Server fns under `referral-tenant.ts`: getMyCommissionSummary,
  listMyCommissions (with effectiveStatus derived from the
  pending→claimable rollover), listMyClaimRequests, getMyPayoutMethod,
  upsertPayoutMethod, submitClaimRequest.
- submitClaimRequest opens a transaction: FOR UPDATE locks all
  candidate commissions (pending-past-clawback OR claimable, not yet
  linked to any request), creates the request row, links them by
  setting claim_request_id + flipping status to 'claimable'. Rejects
  if no payout method or if a prior request is still 'submitted'.
- Best-effort admin email notification on submit, gated behind
  PLATFORM_ADMIN_EMAIL env var. The /admin queue (JUR-90) is the
  authoritative surface; the email is just a heads-up.

Pending → claimable rollover is computed on-read (no cron job) — the
next query naturally reflects the rollover when pending_until elapses.
