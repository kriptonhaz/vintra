---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Expose ~150 server functions to the mobile app via `/api/mobile/<fn>` so every tenant-side screen can run natively without webviews or web fallbacks.

New mobile gateway endpoints span HPP, POS (sale detail, cash sessions, promos, loyalty, settings, prep-waste, billing), inventory (movements, PO CRUD, HPP import), attendance (settings, shifts, QR host, billing), cashflow (entries, accounts, transfers, AR/AP), WhatsApp (instances + messaging), booking (calendar + queue + settings), site (publish + analytics + maintenance), master data (branches/suppliers/categories/customers), settings (account password, announcements admin, members + roles), referrals, onboarding, and creative (Konten/Studio/Logo/Spanduk).

No behaviour change for the web app — every fn was already permission-gated on the server and the gateway just forwards requests with the JWT + tenant header.
