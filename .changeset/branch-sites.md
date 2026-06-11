---
"@vintra/db": minor
---

Phase 4 — per-branch situs foundation. Add a `branch_sites` table (migration `0091`) holding one public site per outlet, used when `tenants.situs_mode = 'per_branch'`. It mirrors `tenant_sites` (draft/published split, maintenance toggle, per-branch `slug`) but is a separate table so the `single`-mode site — keyed by `tenant_id` PK, one row per tenant — and all its existing server functions stay untouched.

Schema foundation only. The per-branch site editor, public routing, and the `single`-mode booking outlet picker are follow-up work in the actively-developed site-template area.
