---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix `/admin/feedback/$threadId` rendering the inbox list instead of the detail page.

In TanStack Router's flat file-based routing, `admin/feedback.tsx` and `admin/feedback.$threadId.tsx` form a parent/child pair — the child only renders if the parent has an `<Outlet />`. The previous commit (`refactor(admin-feedback): move thread detail from sheet`) kept the list page in `feedback.tsx`, so navigating to `/admin/feedback/$threadId` left the URL updated but the list was still painted, making the page look stuck.

Split into the established `help.feedback.*` pattern:
- `admin/feedback.tsx` is now a 13-line `<Outlet />` layout.
- `admin/feedback.index.tsx` is the list page (matches `/admin/feedback/` — note trailing slash in `createFileRoute`).
- `admin/feedback.$threadId.tsx` (unchanged) is the detail.

No server / schema changes.
