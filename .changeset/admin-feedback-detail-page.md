---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Admin feedback inbox: replace the slide-in sheet with a dedicated detail page at `/admin/feedback/$threadId`, mirroring the tenant-side `/help/feedback/$threadId` layout.

**Why.** The sheet was cramped for long threads — messages, the sender + email metadata, the status select, and the composer all competed for vertical space on the right edge of the screen, and once a thread had more than a few replies the message list ate the entire viewport. A full-page detail gives the reply composer room to breathe and matches the muscle memory admins already have from the tenant inbox.

**Changes.**

- New `apps/web/src/routes/admin/feedback.$threadId.tsx` loads via the existing `getAdminFeedbackThread` server fn. Same data, same reply/status mutations.
- `apps/web/src/routes/admin/feedback.tsx` is now list-only: the entire sheet block, `selectedThread` state, `openThread` / `handleReply` / `handleStatusChange` handlers, and their imports (`getAdminFeedbackThread`, `replyAsAdmin`, `setFeedbackStatus`, `Sheet`, `Send`, `Mail`, `useState`, `useToast`) are gone. List rows are `<Link to="/admin/feedback/$threadId">` instead of `<button onClick={openThread}>`.
- Detail page surfaces a back arrow to `/admin/feedback`, the `Publik` source badge + clickable mailto for public threads, the existing status select, and the same "Balasan akan dikirim ke `<email>` via email" hint above the composer that the sheet had.
- Each message now shows its sender label (`Tim Vintra` for admin, `publicName ?? 'Tamu'` for public, `tenantName ?? 'Tenant'` for in-app) instead of only showing it on non-admin bubbles — easier to scan who said what when scrolling through a long thread.

No server / schema changes.
