---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Migrate remaining admin routes to i18n (JUR-140):

- `admin/index` — platform overview dashboard
- `admin/monitoring` — server metrics (RAM/CPU/disk/S3)
- `admin/wa-plans` — WhatsApp AI subscription plan CRUD
- `admin/rag-tools` — RAG tool registry + retrieval preview
- `admin/referrals.config` — global referral cap/window/clawback
- `admin/referrals.claims` — payout queue management

Closes the admin-side i18n migration. All admin pages now flow visible strings, form labels, toasts, confirm dialogs, and aria-labels through `react-i18next`. EN copy is admin-internal — quality bar is functional, not marketing.
