---
"@vintra/web": patch
---

Cap AI logo generation at 1K. The active Flash image model (Nano Banana)
only renders from-scratch text-to-image logos reliably at 1K — 2K came out
washed-out and 4K returned a blank canvas, while still charging 2×/4×
credits. The logo resolution selector is now hidden (single 1K tier) and
the server rejects higher tiers. Konten and Spanduk (image-to-image) are
unaffected and keep the full 1K/2K/4K tiers.
