---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

JUR-149 Feedback Phase 4 — in-app notifications + 24h email fallback.

**Schema.** Migration `0058_feedback_support_notifications.sql` adds two nullable columns (idempotent `ADD COLUMN IF NOT EXISTS`, safe to re-apply on environments that never ran the Phase 1 migration):

- `feedback_threads.tenant_last_viewed_at` — stamped to `now()` every time the tenant opens the thread detail, used to suppress the email fallback once the tenant has actually seen the reply.
- `feedback_messages.email_sent_at` — sticky marker so the daily scheduler tick never re-sends a fallback email for the same admin reply.

**In-app notifications.** New module `apps/web/src/server/feedback-notifications.ts`:

- `notifyAdminsOfNewFeedback` fires when a tenant opens a thread (`kind='new_thread'`) or replies into an existing one (`kind='tenant_reply'`); fans out one notification to every row in `platform_admins` with a `/admin/feedback` deep link.
- `notifyTenantOfAdminFeedbackReply` fires when admin replies; notifies the tenant owner plus every tenant member who has previously posted in the thread, with a `/help/feedback/$threadId` deep link.
- `sendDueFeedbackReplyEmails` is the daily-scheduler job. Picks unread admin replies older than 24h (`tenant_last_viewed_at IS NULL OR < admin reply time`), looks up the tenant owner email via Supabase admin, and sends via the existing Brevo helper — then stamps `email_sent_at` so the next tick skips it.

All three helpers are wrapped in `try/catch` so a notification failure can never reject the underlying feedback write.

**Shared constants.** Three new entries in `NOTIFICATION_TYPES`: `feedbackNewThread`, `feedbackTenantReply`, `feedbackAdminReply` — picked up by the existing `NotificationBell` rendering pipeline.

**Email template.** `buildFeedbackReplyEmail` in `apps/web/src/server/email.ts` renders the Indonesian fallback: subject + 600-char preview of the admin reply + CTA back to the thread, with a footer line explaining why the email was sent (so tenants don't think we're spamming them).

**Scheduler.** `apps/web/src/server/scheduler.ts` daily tick now calls `sendDueFeedbackReplyEmails` after the existing jobs.

**Server fn wiring.** `createFeedbackThread` / `addFeedbackMessage` / `replyAsAdmin` all dispatch the appropriate notification helper after the DB write succeeds. `getFeedbackThread` stamps `tenant_last_viewed_at = now()` on every open so the email fallback is suppressed the moment the tenant sees the reply.

**Route split.** `/help/feedback` is now a layout route (`Outlet`) and the inbox UI moved into a child index file `help.feedback.index.tsx`. The new-thread UI moved from a `Sheet` into a centered `Dialog` so it doesn't fight the thread-list scrollbar on mobile.

**Dialog component.** New `placement="center"` prop on `Dialog` — keeps the existing mobile bottom-sheet behavior as default, but lets the centered variant skip the drag handle and use a single centered card across both breakpoints. Used by the new feedback dialog.

**Admin layout.** `NotificationBell` added to `/admin/*` so platform admins actually see the new admin-side notifications.

**Sidebar housekeeping.** `Bantuan` / `Kirim Feedback` labels migrated to i18n keys (`nav.sectionHelp`, `nav.feedback`). Removes an accidentally duplicated `navFeedback` entry in `admin-sidebar.tsx`.

Migration applied to prod (`feedback_support_notifications`). Typecheck green.
