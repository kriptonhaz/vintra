---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-148 Feedback Phase 3 — public /contact page + Brevo email reply path.

**Public route.** New unauthenticated `/contact` (`apps/web/src/routes/contact.tsx`) using the same landing layout as `/pricing` and `/vs-qasir`. Form fields: name, email, subject, body (RHF + Zod, full Indonesian/English i18n under the new `contact.*` namespace). On success the form swaps to a confirmation screen with CTAs back to `/` and `/pricing`. Discoverable via a new "Kontak" entry in the landing navbar and a "Hubungi Kami" link in the footer's Dukungan section.

**Server fn.** `submitPublicFeedback` in `apps/web/src/server/functions/feedback.ts` — unauthenticated. Writes a `source='public'` thread with `tenant_id=null`, the submitter's name + email, and the client IP. Inserts the first message with `sender_type='public'` and dispatches `notifyAdminsOfNewFeedback` so every platform admin sees the new thread in their notification bell.

**Spam defenses (defense in depth, no single point of failure):**

1. **Honeypot field.** Hidden `website` input (absolutely-positioned off-screen + `aria-hidden` + `tabIndex={-1}` + `autocomplete=off`). Filled by every bot that brute-force-fills inputs; real users skip it. Server silently 200s when filled so the bot can't tune its next attempt.
2. **Cloudflare Turnstile.** Loaded explicitly via `?render=explicit` so it doesn't fight React hydration. Site key (`VITE_TURNSTILE_SITE_KEY`) gates client widget rendering; secret (`TURNSTILE_SECRET_KEY`) gates server-side verification at `challenges.cloudflare.com/turnstile/v0/siteverify`. Both vars empty = captcha disabled (local dev works without a Cloudflare account), and the form still ships honeypot + rate limit + email validation.
3. **Per-IP rate limit.** 5 submissions per rolling hour, keyed off `x-forwarded-for` (first hop) or `x-real-ip`. Counts via a single indexed query against `feedback_threads.submitter_ip` — no in-memory state to lose on PM2 restart, multi-instance safe.
4. **Zod validation.** Trim + length caps on every field, email format, 10-character minimum body to deter one-word spam.

**Schema.** Migration `0059_feedback_submitter_ip.sql` (idempotent — `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) adds:

- `feedback_threads.submitter_ip text` — nullable, populated only for `source='public'` rows.
- `feedback_threads_submitter_ip_created_idx (submitter_ip, created_at)` — supports the rate-limit count query without a sequential scan.

Applied to prod (`feedback_submitter_ip`).

**Admin reply path.** `replyAsAdmin` in `apps/web/src/server/functions/admin-feedback.ts` now branches on `thread.source`:

- `public`: fetches the first message (= the original contact form body), renders `buildContactReplyEmail({ name, originalSubject, originalBody, replyBody, contactUrl })`, and sends via Brevo to `public_email` with tag `contact_admin_reply`. Email failures are logged but never roll back the message insert + status flip — the admin's reply is the source of truth, so a Brevo glitch can't undo it; admin can re-click "Kirim Balasan" to retry the send.
- `in_app`: existing tenant in-app notification path, unchanged.

**Email template.** `buildContactReplyEmail` in `apps/web/src/server/email.ts`. Subject is prefixed `Re: {originalSubject}` so the recipient's mail client threads it. Reply body capped at 8000 chars, original quoted underneath capped at 2000. CTA points back to `/contact` (no inbound email parsing in v1 — spec defers 2-way threading to v2). Footer line explicitly tells the user "balasan email ini tidak terbaca" so nobody expects the reply-to to work.

**Admin inbox extensions.** `getAdminFeedbackThread` now returns `publicEmail` + `publicName`. The detail sheet:

- Shows a `<Globe2/> Publik` badge in the thread list for public threads.
- Renders the submitter as `Name <email@x.com>` (clickable `mailto:`) in the detail header instead of just "Publik".
- Above the composer for public threads, surfaces "Balasan akan dikirim ke `<email>` via email" so the admin knows they're triggering a Brevo send, not an in-app notification.
- Composer placeholder swaps to "Tulis balasan email..." for public threads.

**Env vars.** `apps/web/.env.example` documents `VITE_TURNSTILE_SITE_KEY` (public, browser-exposed) + `TURNSTILE_SECRET_KEY` (server only) with the "both empty = disabled" behavior called out explicitly so a dev pulling fresh doesn't think the form is broken.

**Out of scope (deferred per ticket):** 2-way email threading, inbound email parsing, Phase 4 notifications (already shipped in JUR-149).

**Acceptance criteria verified:**

- Anonymous user submits `/contact` form → sees confirmation screen → thread appears in admin inbox tagged `Publik`.
- Admin reply sends a real Brevo email to `public_email` with `Re: {subject}` subject + quoted original.
- 6th submission within an hour from the same IP throws "Terlalu banyak pesan dari alamat ini. Coba lagi dalam 1 jam." instead of writing a new thread.
- Honeypot fill returns success without writing to the DB.
