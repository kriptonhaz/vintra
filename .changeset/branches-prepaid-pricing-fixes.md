---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Three fixes on the /master/branches page surfaced during user testing:

- **Komplit Annual now uses the right additional-outlet rate.** The
  cost preview was hard-coding the monthly variant's Rp 60k/extra
  because `branchCostBreakdown` picked the first non-comingSoon plan
  by tier alone. A Komplit Annual tenant adding a full-bundle branch
  now sees +Rp 45k/bln (correct) instead of +Rp 60k/bln. The helper
  accepts optional `posPlanKey` + `inventoryPlanKey` hints, and
  `getBranchManagementContext` derives them from each module's latest
  paid `financial_transactions.planKey`.
- **Prepaid-aware copy on the cost preview.** Dropped the misleading
  "akan ditagih pada perpanjangan berikutnya" line — Vintra runs
  prepaid (pay upfront then use), not postpaid. The preview now ships
  an amber notice explaining that the new branch activates after
  admin records the prorated payment, plus a WhatsApp deep-link to
  the admin so the owner can start that conversation in one click.
- **Paid-tier creation routes through admin.** The "Tambah Cabang"
  button on the page header now becomes a WhatsApp CTA ("Tambah
  Cabang via Admin") for any tenant already at 1+ branch on a paid
  module — matching the prepaid model. Free tier keeps the upgrade
  CTA. Server-side allow-list unchanged so admin impersonation can
  still record the branch after payment lands.
- **Summary card drops Absensi/HR.** Attendance is per-staff, not
  per-branch, so "Paket: N/A" was confusing. The HR module toggle on
  individual branches stays (still needed for GPS / schedule).
- Header button no longer wraps to two lines when the page label is
  long — added `shrink-0` + `whitespace-nowrap`.
