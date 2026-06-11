---
"@vintra/web": minor
---

Email receipts to the tenant owner when a payment lands or a refund is processed. Sent via Brevo's transactional API (`BREVO_API_KEY` env var, falls back to a logged no-op when unset). Indonesian copy, brand-matched template that mirrors the Supabase auth emails. Fires alongside the existing in-app notification — never blocks the financial transaction if email delivery fails.
