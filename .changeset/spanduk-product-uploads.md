---
"@vintra/web": minor
"@vintra/db": patch
---

Spanduk generation now accepts up to 4 tenant-uploaded product reference photos that Gemini composes into the banner — useful for "spanduk mie ayam + bakso + es teh" style banners where the actual menu items appear. Schema adds `spanduks.source_image_keys` (jsonb array of S3 keys), the Gemini client accepts a `sourceImages` array of inline image parts, and the seeded prompt template explicitly instructs the model to use supplied product photos as the featured items when present. Source photos are uploaded under `<tenantId>/spanduks/<id>.source-<n>.<ext>` tagged `kind=spanduk` and cleaned up on delete. Credit cost stays at 6 (input images are cheap; the output is what costs).
