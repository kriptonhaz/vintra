---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp Komplit tier: bump replies cap 10k → 20k and clean up the
feature copy so the upgrade story actually matches what each tier
delivers.

- DB: `wa_subscription_plans.max_monthly_replies` for `komplit`
  goes from 10000 to 20000. Now 4× Basic capacity for 3× the price
  (Komplit cost-per-reply Rp 7.45 vs. Basic Rp 9.80) — clean upsell.
- In-app billing page (`/whatsapp/billing`) and public pricing page
  (`/pricing`):
  - Removed "Ketersediaan menu (resep / HPP)" from Komplit's bullet
    list — it was misleading because Basic also has that RAG tool
    (`min_tier='basic'` on `recipe_availability`).
  - Added "ketersediaan menu (resep / HPP)" to Basic's RAG bullet so
    its actual capability is properly disclosed.
  - Komplit replies bullet now reads "20.000 balasan AI/bulan
    (4× kapasitas Basic)" on the landing page.

Admin panel `/admin/wa-plans` reads from the DB directly, so the new
cap shows there automatically — no code change needed.
