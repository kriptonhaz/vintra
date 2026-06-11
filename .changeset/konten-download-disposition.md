---
"@vintra/web": patch
---

Make Konten image downloads work reliably on every browser, including iOS Safari and Brave (which ignore the `<a download>` attribute on cross-origin URLs). The Unduh action now requests a download-specific signed URL that carries `Content-Disposition: attachment` from S3, so a plain anchor navigation forces a download regardless of platform. The Web Share API path is kept for iOS, giving the native Save to Photos sheet when available.
