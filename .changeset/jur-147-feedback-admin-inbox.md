---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-147 Feedback Phase 2 — platform-admin inbox + reply.

**Admin server fns.** `listAdminFeedbackThreads`, `getAdminFeedbackThread`, `replyAsAdmin`, `setFeedbackStatus` in `apps/web/src/server/functions/admin-feedback.ts`. Every fn is gated by `requirePlatformAdmin` so tenant accounts can never reach cross-tenant threads. `listAdminFeedbackThreads` supports filtering by status (`open` / `replied` / `resolved` / `all`), source (`in_app` / `public`), and a substring search across subject + body — needed so the inbox stays usable once volume grows.

**Route.** `/admin/feedback` renders the filter bar + thread list with status pills, and opens the selected thread in a sheet with the full message history, a reply composer (writes a message with `sender_type='admin'`), and a status select for marking threads resolved.

**Admin sidebar.** New "Feedback" entry under the Modules section.

Notifications (admins-on-new-thread, tenant-on-reply, 24h email fallback) follow in JUR-149.
