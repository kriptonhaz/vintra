---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": minor
---

Add Vintra AI — a business Q&A assistant over the tenant's own reports.

The owner asks in plain Indonesian ("menu mana yang paling untung bulan ini?",
"stok apa yang mau habis?") and the assistant answers by calling the reports it
is allowed to read: POS sales, sales by product, cashflow dashboard and today's
summary, inventory overview, today's attendance, and HPP margins.

It is not a general chatbot. It can call those seven read-only functions and
nothing else, it cannot modify data, and no chat history is stored.

Bundled into the existing **Komplit** tier rather than given a tier of its own,
which is how JuraganQu ships it. Vintra sells a single Rp 149.000 package, so
stacking another price level above it would work against that — and no tenant
is paying for the first level yet. Spend is metered per call in
`ai_usage_logs`, so the cost of the decision is visible before it has to be
made again.

Two independent gates: the tier decides whether a business has the assistant,
and `tenant_members.ai_enabled` (migration 0146, default off) decides which
staff may use it — the assistant reads sales, cashflow and margin figures an
owner may not want every cashier seeing. Owners always pass.

Also capped: 50 messages per tenant per day, 4 tool-calling rounds per
question, and tool results truncated before they reach the model.

No new AI infrastructure was needed — the provider config, API keys and usage
metering already existed for the logo generator; this adds the `text`
capability lookup alongside the existing `image` one.
