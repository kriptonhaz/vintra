---
"@vintra/web": minor
"@vintra/shared": patch
"@vintra/db": patch
---

JUR-176: mobile polish + template feedback round 2.

**Hero**:
- Carousel: `heroImages` repeater (max 3) replaces the single
  `heroImageAssetKey`. New `carouselAutoSlide` toggle and
  `carouselDurationSec` select (3/5/7/10s). Cross-fade transitions
  with click-dots. Backwards-compat in the normalizer: the old
  single-image key auto-promotes to `heroImages[0]` so existing
  tenants don't lose their photo.
- CTA button now always renders when `ctaText` is non-empty (was
  hidden when href couldn't resolve, e.g. WA action + empty number).
  Falls back to `'#'` href instead of vanishing.

**Services**:
- New `gridColumns` select (2/3/4 desktop, mobile stays 2) —
  matches the gallery section's UX. Desktop breakpoints widened to
  `lg:` / `xl:` so the narrow editor preview shows mobile-2-col
  truthfully (vs. the live full-width page hitting 3 or 4 cols).
- New `priceFormat` select: 'full' (`Rp 25.000`) or 'short'
  (`Rp 25K`). Compact `formatRupiahShort` helper added — values
  ≥1JT use "JT" suffix.
- Cards are now `@container` (Tailwind v4 native container queries).
  Text scales with card width, not viewport. Short-format prices
  scale larger than full-format at the same card width because the
  shorter string has visual room.
- `whitespace-nowrap` on prices, `overflow-wrap: anywhere` on names
  — no more "Rp / 4K" stacking or word-per-line wraps in tight
  cards.

**Queue**:
- Editor-only empty-state hint: when the section is enabled but
  the tenant's mode isn't 'queue' OR there are no active resources,
  the editor preview shows an amber dashed-border explainer
  pointing to `/booking/settings`. Public visitors still get
  silent return (no empty card). Driven by new `isEditorPreview`
  flag on `SectionRenderProps`.

**Branches**:
- Grid now `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (was
  `sm:grid-cols-2` which crushed cards on common phone widths).
- `flex-wrap` on the heading row so the "Utama" badge falls to a
  second line instead of clipping behind the name.
- `break-words` on long addresses.

**Mobile audit (all sections)**:
- Tightened padding (`py-12 sm:py-16 lg:py-20`), heading sizes
  (`text-2xl sm:text-3xl lg:text-4xl`), and gap spacing
  (`gap-3 sm:gap-4`) across hero, about, services, queue, branches,
  hours, maps, gallery, contact, cta-banner.
- Maps iframe height now responsive (320 → 400 → 480px).
- Gallery 2-col on mobile (was 1-col).
