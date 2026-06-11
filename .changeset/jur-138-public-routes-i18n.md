---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Migrate public routes to i18n (JUR-138):

- Auth flow (login, register, forgot-password, reset-password, OAuth callback)
- Help center (index + article view)
- Comparison page (`/vs-qasir`)
- Legal docs (Privacy Policy, Terms of Service)

All visible JSX strings, form validation errors, and `head()` meta tags now flow through `react-i18next`. Indonesian copy remains the source of truth; English translations follow these rules: Kasir → Cashier, Kelola → Configure, HPP → Cost of Goods Sold. Long-form legal docs were migrated mechanically — English copy in `privacy.tsx` / `terms.tsx` should get a legal/native-speaker review before being marketed externally.
