---
"@vintra/web": minor
"@vintra/db": minor
---

Stamp programs gain an optional banner image, and the situs editor gets two new sections — **Promo** and **Program Stempel** — that auto-pull from the tenant's active POS data.

**Stamp banner** (admin): the stamp editor now accepts a 2 MB image. Stored at `<tenantId>/stamps/<programId>.<ext>` with S3 tag `kind=stamp` (long-lived). Shown as a thumbnail in the admin program list and the cashier stamp strip; if none uploaded, a brand-colored stamp glyph stands in.

**Promo section** (situs editor): adds `Promo` to the section picker. Config: heading, layout (grid/list), columns (2/3/4), `showImage`, `showCode` (toggle for whether redemption codes appear publicly), `limit` (all/3/6/9), `hideExpired`. Renders active `tenant_promotions` with their banners, discount label, validity, and product target (for `auto_product` promos).

**Stamp section** (situs editor): adds `Program Stempel` to the section picker. Config: heading, subheading, layout, columns (2/3), `showImage`, `showReward`. Renders active stamp programs with their banner or a brand-colored fallback, the "Beli Nx gratis 1" tagline, and the pre-built reward summary (works for both single + bundle rewards). Customer progress isn't shown — public page is anonymous; cashiers see live progress in `/pos/cashier`.

`PublicSiteRenderData` gains `promos` and `stampPrograms` arrays; both the public-site loader (`public-tenant.ts`) and the editor-preview loader (`tenant-site.ts:getEditorPreviewData`) hydrate them with pre-signed image URLs and pre-formatted labels so the renderers stay simple.
