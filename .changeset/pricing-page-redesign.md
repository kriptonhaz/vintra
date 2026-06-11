---
"@vintra/web": minor
---

New `/pricing` page (Qasir-style) + homepage pricing teaser redesign.

The previous homepage pricing section forced prospects through a 4-module-tab UI to discover the Komplit bundle, which buried our headline product behind a navigation step. Reworked into a Qasir-aligned structure: focused homepage teaser + dedicated `/pricing` destination for deep detail.

**New `/pricing` route**:
- Hero with three marketing wedges (cheaper than Qasir, no 24-month lock, HPP gratis)
- 4 plan cards: Free + Komplit Annual ⭐ + Komplit Monthly + Enterprise
- Comparison table with 6 category groups (Sistem Kasir POS / Inventori / Laporan / Kelola Outlet / Pegawai / Strategi Bisnis) — Free vs Komplit vs Enterprise. Mobile layout stacks each row's tier values into a 3-tile grid below the label so horizontal scroll doesn't kill the table on phone
- "Butuh satu modul aja?" per-module section: POS Toko / Inventory / Absensi cards with prices and CTAs
- Bandingkan dengan Qasir callout — side-by-side mini-table proving the Rp 40k/yr savings on 1 outlet, scaling to Rp 720k/yr on 3 outlets
- 10-question FAQ accordion covering the most-asked sales questions (commitment, free trial, multi-outlet, migration, payment, tax, upgrade, cancel, SLA)
- CTA banner with "Mulai Gratis" + "Konsultasi Migrasi" actions
- Mobile-responsive throughout: cards reflow 1→2→4 col, comparison table stacks on phone, all tap targets ≥44px

**Homepage pricing section redesign**:
- Replaced the 4-module-tab UI with a focused 3-card teaser: Free / Komplit Annual ⭐ / Komplit Monthly
- Each card is tappable → `/pricing`
- Single primary CTA below: "Lihat Detail Harga + Perbandingan Fitur" → `/pricing`
- Secondary link: "Atau cek harga per modul" → `/pricing#per-modul`
- Result: homepage stays clean, deep detail moves to its own destination, prospects pre-disposed to a tier when they land on `/pricing`

**Cleanup**:
- Removed ~700 lines of dead code from `index.tsx`: the four per-module pricing panels (`HppPricingPanel`, `AbsensiPricingPanel`, `InventoryPricingPanel`, `POSPricingPanel`), their supporting display data (`INVENTORY_DISPLAY`, `POS_DISPLAY`, etc.), `PRICING_TABS` + `PricingTab` type, `COMING_SOON_MODULES`, and the per-module WhatsApp helper consts. All of that lives on `/pricing` now in cleaner form.

The whole pricing surface now follows the Qasir pattern: one product to anchor on (Komplit), simple tier choices, deep comparison + FAQ on a destination page. Reduces decision paralysis while still preserving per-module à-la-carte for tenants who only want one feature.