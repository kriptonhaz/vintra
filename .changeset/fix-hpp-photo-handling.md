---
"@vintra/web": patch
---

Fix HPP product photo handling across the calculator and the POS bridge:

- The previously-saved photo now loads into the preview when editing a product
  (the load effect was cancelling its own in-flight signed-URL fetch).
- The review-step photo preview shows the whole image (`object-contain`) instead
  of cropping it.
- "Jual di POS" now carries the HPP product's photo onto the new inventory item.
  The browser was fetching the presigned URL to re-buffer the bytes, which needs
  bucket CORS and silently failed; the photo is now previewed via the signed URL
  and copied server-side (in-bucket S3 CopyObject) to its own inventory key on
  save, with an independent lifecycle.
