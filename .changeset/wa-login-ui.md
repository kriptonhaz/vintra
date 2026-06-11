---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp staff OTP login — login UI (PR 5 of the series). Adds a new route `/auth/wa-login/$tenantSlug` with a two-step state machine:

1. Phone input — user enters their WA number. Accepts `08xx`, `+62 8xx`, `628xx`. Shared `normalizeIDPhone()` from `@vintra/shared` canonicalizes before the API call.
2. Verify — page shows a green "Buka WhatsApp" CTA opening the wa.me deep link with the prefilled "Minta OTP Login Vintra" text. User sends, gets the code on WhatsApp, types the 6 digits back. 5-minute countdown displayed; expired state disables the verify button.

On verify success the server fn returns Supabase session tokens; the page sets sb-access-token / sb-refresh-token cookies (mirrors the email/password path) AND calls `supabase.auth.setSession()` on the browser client so signOut/refresh continue to work. Then navigates to `/dashboard`.

The existing `/auth/login` page gets a passive emerald hint card directing staff to ask the owner for the tenant-specific login URL — owners share `vintra.my.id/auth/wa-login/{slug}` with staff once and they bookmark it. The owner-facing UI for managing this ships in PR 6.

Error messages from the API are mapped to short Indonesian strings ("Kode salah atau sudah kadaluarsa", "Login WhatsApp belum aktif untuk toko ini", etc.) — never reveal which specific failure mode hit.
