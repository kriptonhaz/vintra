---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Centralize the sales WhatsApp phone number (JUR-127):

The `6287765685391` number was duplicated across 11 files as a `const WA_PHONE = '...'`. The original placeholder `628123456789` (caught and fixed previously) routed every "Hubungi Sales" / "Aktifkan" CTA into the void — so this consolidation prevents the next phone-number-typo bug.

- New exports in `apps/web/src/lib/constants.ts`:
  - `SALES_WHATSAPP_PHONE` — the digits-only number
  - `buildSalesWaUrl(message)` — returns `https://wa.me/${SALES_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`
- All 11 call sites switched over; `bun run typecheck` is green.
