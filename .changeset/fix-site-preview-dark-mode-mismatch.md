---
"@vintra/web": patch
---

Fix the Situs live preview not matching the deployed public page. The preview renders inline inside the admin app, so when the admin was in dark mode the public sections' `dark:` variants activated (dark background, inverted text) — but the deployed public site is always light. Added a `.light-scope` wrapper (excluded from the `dark` variant in `app.css`) around the preview render so it always renders light, exactly like the live page.
