---
"@vintra/db": patch
---

WhatsApp AI order lookup now also answers "total berapa & bayar ke mana?". The order-status RAG snippet now includes each order's payment method, and for orders still awaiting a bank transfer it appends the tenant's transfer account(s) (bank, number, holder) from POS settings. The tool's trigger keywords were broadened to fire on payment/total follow-ups (total, bayar, rekening, transfer, …), which the keyword gate previously missed since it only inspects the current message.
