---
"@vintra/web": minor
"@vintra/db": minor
---

Add resolution tiers to Konten image generation. The generate page now has a 1K / 2K / 4K selector (defaulting to 1K), and credit cost scales with resolution — Nano Banana charges more for higher resolutions. Per-resolution `{ credits, priceUsd }` is configured per image-capability provider in the admin AI providers panel (replacing the single image price), and the selected tier flows through the credit pre-check, deduction, the Gemini request, and the generation record.
