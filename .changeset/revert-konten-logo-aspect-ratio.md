---
"@vintra/web": patch
---

Revert the previous "pass `imageConfig.aspectRatio` on every Gemini call" change for Konten and Logo. The aspect-ratio signal stays in the prompt only (Konten relies on its field-option fragments; Logo's prompt template already says "1:1 square"). Spanduk keeps the structured-config approach since print-shop physical dimensions are the authoritative source there — `pickGeminiAspectRatio` moves back into `spanduk-compositor.ts` and the short-lived shared `gemini-aspect.ts` helper is removed.
