---
"@vintra/web": minor
"@vintra/db": minor
---

Inventory item photos + brand field.

**Photos**
- New `<PhotoUploadField>` component with a source-picker modal: pick **Kamera** or **Galeri**. On phones/tablets the camera tile uses the native `<input capture="environment">`; on desktops it routes to a new `<WebcamCaptureDialog>` powered by `getUserMedia` (live preview, snap, restart). Stream lifecycle cleans up on close so the camera light never lingers.
- Client-side compression (`apps/web/src/lib/image-compress.ts`): canvas resize to ≤800 px longest edge + JPEG q=0.8. Typical 4 MB phone photo lands at ~80–150 KB before upload.
- S3 helpers in `apps/web/src/lib/s3-storage.ts`: `uploadInventoryItemPhoto`, `getInventoryPhotoSignedUrl`, `deleteInventoryPhoto`. Tagged `kind=inventory-item` so the existing 60-day attendance lifecycle rule never sweeps inventory photos. 500 KB server-side ceiling.
- Server fns: `uploadInventoryItemPhotoFn`, `removeInventoryItemPhoto`, `getInventoryPhotoUrls` (batch signed URLs for the list view). `getInventoryItem` now returns `photoUrl` inline; `deleteInventoryItem` (hard delete) also cleans the S3 object.
- UI: thumbnail on each row of the items list (signed URLs cached via React Query for ~4 min); photo on the detail header; upload field in both create + edit forms.

**Brand**
- New `brand` text column on `inventory_items` (migration `0014_inventory_brand.sql`).
- `listInventoryItems` resolves the effective brand at the SQL layer with `COALESCE(NULLIF(i.brand, ''), m.brand)` — items linked to an HPP material inherit the master brand for free.
- `getInventoryItem` returns `linkedHppBrand` separately so the detail header can render a "Dari HPP" pill when the fallback kicks in.
- `<BrandInput>` in the create form auto-fills when an HPP material is picked; placeholder + hint show the HPP brand even when the user hasn't typed anything yet.
- Brand renders on item-list rows (between SKU and category) and the detail header.

i18n: `fieldPhoto`, `fieldBrand`, `fieldBrandPlaceholder`, `fieldBrandPlaceholderFromHpp`, `fieldBrandFromHppHint`, `brandFromHppBadge`.
