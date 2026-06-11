---
"@vintra/web": patch
---

Fix blank camera frame on Mi Browser (and other Chromium-based mobile
browsers) when taking attendance photo. `PhotoCheckIn` was trying to
set `videoRef.current.srcObject` before React had mounted the
conditionally-rendered `<video>` element — the ref was still null so
the assignment silently skipped. The camera stream was acquired
(hence the in-use notification) but never attached to the DOM.

- Flip `streaming=true` first so the element mounts, then attach the
  stream in a `useEffect` once the ref is available.
- Explicitly call `.play()` — Mi / UC / Huawei browsers ignore the
  `autoplay` attribute alone.
- Add `autoPlay` attribute for broader compatibility.
- Clear `srcObject` when stopping so the element releases the stream
  cleanly.
