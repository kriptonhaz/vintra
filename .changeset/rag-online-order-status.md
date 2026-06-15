---
"@vintra/web": minor
"@vintra/db": minor
---

WhatsApp AI can now look up Toko Online order status by the buyer's WhatsApp number. A buyer who lost their order number can message e.g. "pesanan saya sampai mana?" and the AI replies with their order(s) — number, status, items, total, and courier/resi for shipped ones — listing all when there's more than one. Scope: in-progress orders plus those completed in the last 14 days (cancelled excluded). New `online_orders_status` RAG tool (keyword-triggered, Komplit tier); tenants enable it per WhatsApp instance like any other RAG tool.
