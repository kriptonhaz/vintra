---
"@vintra/web": patch
---

Make the Konten "Unduh" button do an actual download instead of opening the iOS share sheet. The Web Share API path is gone — the anchor click on the Content-Disposition: attachment signed URL is enough to force a download on every platform without the misleading share UI.
