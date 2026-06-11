---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-146 Feedback Phase 1 — tenant-side feedback inbox.

**Schema.** New `feedback_threads` + `feedback_messages` tables in `packages/db/src/schema/feedback.ts`. A thread carries the tenant scope, subject, status (`open` / `replied` / `resolved`), and an optional `public_email` / `public_name` pair so the same tables can later host non-authenticated submissions. Messages carry `sender_type` (`tenant` / `admin` / `public`), the body, and the sender user id when known.

**Server fns.** `createFeedbackThread`, `addFeedbackMessage`, `listFeedbackThreads`, `getFeedbackThread` — all gated by `requireAuth` and scoped to the caller's tenant. `getFeedbackThread` joins the messages chronologically so the detail route can render a thread in a single round-trip.

**Routes.** `/help/feedback` lists the tenant's threads with status pills + last-activity timestamps; an inline "Kirim Feedback" sheet form opens a new thread. `/help/feedback/$threadId` renders the conversation with a reply composer at the bottom.

**Sidebar.** New "Bantuan" section with a "Kirim Feedback" entry so the inbox is reachable from every authed page.

Phase 2 (admin side) and Phase 4 (notifications + email fallback) follow in JUR-147 / JUR-149.
