---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Comp / free-access grants — Rp 0 module activation with founder approval (JUR-194).

Platform admins can now give a tenant a module for free without it polluting revenue.

- New `comp_grants` table + an `is_founder` flag on `platform_admins` (migration `0081`, founder seeded).
- A comp activates the chosen module at Rp 0 with a mandatory reason and is recorded **only** in `comp_grants` — never as a `financial_transactions` row — so it never counts as income.
- The founder can apply a comp instantly; a non-founder admin's request goes to `pending` and notifies the founder, who approves or rejects it on the tenant detail page.
- A "Komplit" comp lights up POS + the bundled Inventory + Attendance.
- New "Akses Gratis (Comp)" section on the admin tenant detail page: a grant form (module / tier / duration / reason) and the tenant's comp history with status + approve/reject.
