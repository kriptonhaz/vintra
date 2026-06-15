---
"@vintra/web": patch
---

Fix: the editor's desktop live preview stopped scaling down (showed a zoomed/cropped page) after the mobile-preview iframe change. The centering wrapper let the 1280px iframe blow out the width measurement so the fit-to-width scale computed ~1. Reworked the frame to measure width from a stable overflow-hidden block container (iframe layout box is clipped, not counted), with the iframe height tracked via a ResizeObserver inside the iframe so it stays correct on live edits. Mobile frame is centered; desktop scales to fit as before.
