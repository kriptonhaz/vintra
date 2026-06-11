---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-176 v2: section-builder rebuild.

The tenant public site is now a list of modular sections the tenant
can enable, disable, reorder, and configure individually — not a fixed
template with predetermined slots.

**New settings shape** `{ theme, sections[], seo }`:

- `theme`: brand color + accent + font choice (Inter / Poppins / Lora / system)
- `sections`: ordered list of `{ id, type, enabled, settings }`
- `seo`: page title + description + OG image asset key

**Ten section types**:
- `hero` — three layouts (color-bg, image-bg full-bleed, split text-left/image-right) with configurable CTA
- `about` — centered or side-by-side text + image
- `services` — auto-pulled from inventory (grid or list), optional duration
- `queue` — live antrian (auto-shows when booking mode = queue)
- `branches` — multi-branch cards with Google Maps deeplinks
- `hours` — per-day table, today highlighted in brand color
- `maps` — Google Maps embed (URL or address; falls back to main branch)
- `gallery` — image grid with repeater field (2/3/4 columns, captions)
- `contact` — branded band with WhatsApp + phone + email + Instagram
- `cta-banner` — mid-page CTA (brand-color band or outline-minimal)
- `footer` — system-managed Vintra stamp (always last)

**Editor UI**: vertical section list with toggle / up-arrow / down-arrow /
expand-to-edit / delete. "+ Tambah Section" modal picker (searchable,
hides already-added singletons). Theme card on top, SEO card at bottom.
Preset picker ("Ganti Preset" button) with 6 starters: Mini, Warung
Modern, Kafe/Resto, Toko Retail, Salon/Jasa, and new **Cuci Motor /
Walk-in** preset. Confirm dialog before overwriting draft.

**Modern visual polish**: generous padding (`py-16+`), proper typography
hierarchy, brand color used as accents rather than flat fills, hover-
lift cards, smooth transitions.

**Backwards-compatible**: `normalizeSettingsV2()` accepts both shapes
— old v1 flat keys are converted to v2 on the fly. No schema migration.
Tenants without a published site fall back to the JUR-185 baseline
queue page (no regression for the cuci motor customer already live at
mantra.vintra.my.id).
