---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-90: admin claim queue + payout marking.

- New /admin/referrals/claims page with status filter pills (All /
  Submitted / Paid / Rejected) and a sorted table — submitted bubbles
  to the top, then newest first.
- Detail Sheet with copyable bank info, copyable nominal, list of
  commissions in the claim, admin notes, and two outcomes:
  - **Mark Paid** confirms via ConfirmDialog, propagates `status = paid`
    to every linked `referral_commissions` row, writes a
    `platform_admin_audit_logs` entry, sends a confirmation email to
    the tenant.
  - **Reject** requires a reason, releases linked commissions back to
    `claimable` (no `claim_request_id`) so the tenant can re-submit
    after fixing whatever the admin flagged, writes an audit log
    entry, sends a rejection email with the reason.
- Both endpoints are gated by `requirePlatformAdmin` and use FOR
  UPDATE row locking inside a transaction. Idempotent on
  `paid → paid` (returns alreadyPaid=true) and `rejected → rejected`;
  blocks `paid → rejected` and vice versa.
- Sidebar entry "Klaim Referral" added next to "Konfigurasi Referral".

Tenant-side email notification reuses the existing Brevo `sendEmail`
helper. Owner email is resolved by looking up
`tenants.owner_id → supabase.auth.admin.getUserById()`. Send failures
are logged and never roll back the state change.
