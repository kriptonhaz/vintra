---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Per-branch receipt footer + logo overrides.

The receipt footer + logo lived only on `pos_settings` (one per tenant) — fine for single-outlet warungs, but multi-branch tenants on Bisnis (3 outlets) and Multi-Outlet (unlimited) were stuck printing the same address line at every counter. Misleading the moment a tenant added their second branch.

Move both fields onto `branches` as nullable overrides; the existing `pos_settings.receipt_*` becomes the default that any branch with `NULL` inherits. Receipts render `COALESCE(branches.field, pos_settings.field)` so single-branch tenants see zero behaviour change.

UX:
- Single-branch tenant: settings page hides the dropdown, edits tenant default as before.
- Multi-branch tenant: a "Berlaku untuk" picker appears. Default tab edits the tenant fallback; per-branch tabs edit `branches.receipt_*`. Empty footer in a branch tab shows "Pakai default: …" placeholder so the inheritance chain is visible. Branch logo gets a "Hapus, pakai default" link to revert to the tenant logo.

Server: new `updateBranchReceipt` for per-branch saves; existing `uploadReceiptLogo` accepts an optional `branchId` so the upload writes to the right scope. Migration `0030_branch_receipt_overrides.sql` adds the two nullable columns to `branches`.
