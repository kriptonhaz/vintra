---
"@vintra/web": minor
---

Logo AI Phase 4 — the tenant-facing UI. `/logo/generate` renders the admin-configured fields dynamically: `select` fields become dropdowns (with optional free-text fallback), `text` fields become plain inputs (business name, tagline). After picking a resolution and hitting generate, the AI-generated logo appears with a download button. `/logo` is the gallery — grid of past logos with status badges, click for a fullscreen lightbox, plus per-card download and delete.
