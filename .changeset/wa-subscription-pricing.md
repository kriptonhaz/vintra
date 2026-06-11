---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Introduce WhatsApp AI subscription tiers with monthly-reply limits.

- New `wa_subscription_plans` table seeds three platform-managed tiers:
  - `basic` Rp 99.000/mo — 1 instance, 1.000 AI replies, stock-scoped RAG (future).
  - `komplit` Rp 299.000/mo — 3 instances, 5.000 AI replies, full RAG (future).
  - `enterprise` Rp 800.000/mo — 10 instances, 50.000 AI replies, full RAG (future).
- New `wa_settings` table holds each tenant's current tier + subscription window.
- `ai:reply` worker now enforces the monthly reply cap before invoking the AI provider; over-limit messages skip silently with a structured warn log.
- Admin "Paket WhatsApp" page lets platform admins edit each plan's price, instance/reply limits, RAG scope, and active flag.
- WhatsApp instance list shows a subscription usage card (progress bar against monthly cap) with an amber warning at ≥90% utilization.
- New `GET /v1/wa/subscription` returns the tenant's current tier, limits, used replies, and subscription expiry for the UI.
- `rag_scope` column is wired into the schema and admin UI but **not yet read by the worker** — feature-gated RAG retrieval is tracked separately and will follow in a later milestone.
