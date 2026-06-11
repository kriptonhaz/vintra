---
"@vintra/web": minor
---

Add AI image generation for Konten Promosi. A new Gemini image client and the `generateKontenImage` server function take a product photo plus a preset (or custom prompt), call the default `image`-capability provider, and store the enhanced result. Generation deducts 1 credit transactionally on success, logs usage to `ai_usage_logs`, and records failures in the gallery. Includes `getKontenStatus`, `listKontenImages`, and `deleteKontenImage`, plus four enhancement presets (white background, studio lighting, lifestyle, remove background).
