---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Add optional photo support to HPP products.

**Schema.** New nullable `products.photo_key` column (migration `0057_hpp_products_photo.sql`). Stores a Supabase Storage object key the same way `inventory_items.photo_key` does — short-lived signed URLs are minted on read, never written into the DB.

**Upload UI.** `/hpp/calculate` step 4 (Ringkasan) gains an optional `PhotoUploadField` in place of the old static Coffee icon. The widget compresses the picked file client-side (~800px JPEG ≤500 KB) and the parent wizard fires `uploadHppProductPhotoFn` only after `createProduct` / `updateProduct` succeeds, so a photo failure can't leave the product half-created. Edit mode seeds the preview from the saved key via a signed URL.

**Thumbnail column.** The `/hpp` "Daftar Perhitungan Produk" table replaces its first-letter avatar circle with a 40×40 image thumbnail. Visible page's photo keys are batched into a single `getHppPhotoUrls` server call so we don't fan out N round-trips per row.

**Read-time fallback.** When `products.photo_key` is null, `getHppReport` looks up any `inventory_items` row whose `linked_hpp_product_id` points at the HPP product and surfaces its `photo_key` as `effectivePhotoKey`. This is display-only — never copied at write time, so if the link is removed the HPP product silently falls back to the placeholder. Matches the spec from the UI/UX review: "if user leaves empty on create and it's connected with POS, then the POS item's image is linked to the HPP as well."

**Server fns added.** `uploadHppProductPhotoFn`, `removeHppProductPhoto`, `getHppPhotoUrls`. **S3 helpers added.** `uploadHppProductPhoto`, `getHppProductPhotoSignedUrl`, `deleteHppProductPhoto` (S3 key pattern `{tenantId}/hpp/{productId}.{ext}`, tag `kind=hpp-product`).
