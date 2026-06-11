---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-13: Launch wrapper — help center + onboarding tour + `/vs-qasir`.

The harvest of W1–W5: shipped features need surfaces where new owners discover them. This ticket lands all three:

**Help center** (`/help`, `/help/$slug`):
- 8 articles in Indonesian covering the full feature surface (cashier basics, inventory + tier pricing, recipes + ingredient deduction, loyalty, promo, multi-outlet, thermal print, tax + discount math)
- Articles stored as TS modules in `apps/web/src/lib/help-articles.tsx` (no DB, no markdown parser dep — JSX bodies render directly)
- Index page groups by category (Mulai / Kasir / Inventaris / Penjualan / Lanjutan)
- Article pages have prev/next nav + back-to-index + reading-time estimate
- New `.article-prose` CSS scope in `app.css` for clean Indonesian long-form typography

**Onboarding tour** (dashboard):
- 5-step modal walkthrough: HPP → Inventaris → Resep → Kasir → WhatsApp share
- Auto-fires on first dashboard visit per (browser, tenant) — localStorage flag prevents repeat
- Re-launchable from new "?" icon in dashboard header
- Each step includes deep-link CTA ("Buka HPP", etc.) so the owner can actually go try the feature
- No library dep — ~150 lines of plain React (full-screen modal sequence, not anchored tooltips)

**`/vs-qasir`** comparison page:
- Public route (no auth). Direct-conversion landing for tenants evaluating us against the obvious competitor
- Hero + dual pricing card (Qasir Rp 700k vs Komplit Rp 660k) + feature comparison table (11 rows, with rows highlighting Vintra's clear wins)
- Dual CTAs: "Coba Gratis Sekarang" → /auth/register + "Konsultasi Migrasi" → WhatsApp deep-link
- Migration callout block + bottom CTA

**Landing nav**:
- Default nav links updated: Harga / Bandingkan vs Qasir / Bantuan (overrideable via `navLinks` prop on each page that uses `LandingNavbar`)

**Out of scope** (per spec):
- Smoke test + production deploy + email/WA announce — handled separately by founder
