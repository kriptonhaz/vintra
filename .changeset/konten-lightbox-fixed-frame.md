---
"@vintra/web": patch
---

Lock the Konten gallery lightbox image area to a fixed square frame. The image inside scales via `object-contain`, so swapping between a portrait source and a square result no longer makes the frame jump shape — portrait images get letterboxed instead of stretching the modal.
