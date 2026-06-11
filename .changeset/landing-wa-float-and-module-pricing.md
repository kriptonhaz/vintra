---
"@vintra/web": minor
---

Landing page: add floating WhatsApp button and rework the pricing
section to reflect per-module billing.

- New `WhatsappFloat` component in the bottom-right corner on the
  landing page, pointing at the sales number with a preset "Halo, saya
  ingin bertanya seputar Vintra" message. All three WA entry points
  on the page (pricing CTA, CTA section, floating button) now share one
  source of truth for the phone + preset.
- Dropped the old three-tier legacy plans — they
  conflicted with per-module billing. Pricing now shows: HPP (free),
  Absensi with a 4-row commitment table (1 bulan Rp 8.000 → 12 bulan
  Rp 5.000 per staf/bulan, with savings badges and a "Terbaik"
  highlight on 12-bulan), and a compact "Modul Berikutnya" card listing
  POS, Inventory, and Finance as coming soon.
