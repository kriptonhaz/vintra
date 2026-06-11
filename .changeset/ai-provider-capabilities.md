---
"@vintra/web": minor
"@vintra/db": minor
---

Split AI provider configs into a connection record plus per-capability rows. `ai_provider_configs` now holds only the connection (model, base URL, API key); a new `ai_provider_capabilities` table carries one row per capability (text / image / video) with its own pricing and a per-capability default. This lets a single model serve text and image generation at different price points without duplicating the connection. The admin AI providers UI now manages capabilities, and the WhatsApp reply worker reads text pricing from the text capability.
