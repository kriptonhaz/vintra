---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-184 follow-up — booking settings now surfaces existing Anggota Tim with a toggle.

The original JUR-184 staff section only read from `booking_resources`, so tenants who already had members in `/settings/members` saw an empty list and were forced to re-add everyone. The mental model is wrong: `/settings/members` should be the source of truth for "people who work here", and `/booking/settings` should be a filter view of "which of those people take bookings".

**Server fns.**

- **EXTEND** `getBookingSettingsState` returns three lists now: `settings`, `members` (every `tenant_members` row with role in owner/admin/supervisor/staff/cashier, LEFT-JOINed to `booking_resources` so each row carries `resourceId` indicating whether the toggle is currently ON), and `resourceOnly` (only `booking_resources WHERE member_id IS NULL` — the "tanpa akun" staff). Resources linked to members get surfaced via `members` to keep the UI from rendering the same person twice.
- **NEW** `toggleMemberBookable({ memberId, enable })` — flips calendar visibility for an existing tenant_member. `enable=true` creates a `booking_resources` row linked via `member_id`, auto-named from `firstName + lastName`; on the rare unique-constraint collision (two members with identical names) retries with a 4-char id suffix. `enable=false` deletes the linked resource (soft-blocked when active bookings reference it). Never touches `tenant_members` — calendar visibility is decoupled from membership.
- **SIMPLIFY** `addBookingStaff` — drops the `email` + `phone` parameters and the entire Supabase invite path. Now only writes a `booking_resources` row with `member_id=NULL`. The "invite a new team member" flow stays in `/settings/members` (canonical), no longer duplicated here. Removes the Supabase admin client + `roles` + `tenantMemberBranches` imports from this file.

**UI rewrite (`/booking/settings` staff section).**

Now two clearly-labeled sublists:

- **Anggota Tim** — every eligible `tenant_members` row with a "Tampil di kalender" checkbox. Toggling on/off calls `toggleMemberBookable`. Includes role chip + phone. Empty state links to `/settings/members` for the canonical invite flow.
- **Staf Tanpa Akun** — `booking_resources WHERE member_id IS NULL`. Name + delete. `+ Tambah staf tanpa akun` button opens a simplified sheet with just the name field.

Sticky `+ Tambah Anggota Tim` link at the section header routes to `/settings/members` so adding a real team member is one click away.

**Sync model (now fully symmetric).**

- Add member in `/settings/members` → appears in `/booking/settings` Anggota Tim with toggle OFF by default. Toggle ON to make them appear in the calendar.
- Toggle ON here → `booking_resources` row created → calendar column appears.
- Delete member from `/settings/members` → FK from JUR-182 sets `booking_resources.member_id` to NULL → resource becomes orphaned (moves into "Staf Tanpa Akun" sublist on next page load). Calendar still shows the name; booking history preserved.

**i18n.** Dropped: `addStaffDesc`, `staffEmailLabel`, `staffEmailHint`, `staffEmailNoPermHint`, `staffPhoneLabel`, `staffEmptyState`, `staffLinkedBadge`, `staffResourceOnlyBadge`, `staffDeactivate`, `staffActivate`, `staffIsActive`, `staffSyncHintPrefix`, `staffSyncHintLink`, `editResource`. Added: `staffSectionDesc`, `staffSectionTeam`, `staffSectionResourceOnly`, `bookableToggleLabel`, `addTeamMemberLink`, `noMembers`, `emptyResourceOnly`, `addStaffNoLogin`, `addStaffNoLoginDesc`.

Typecheck green. No schema/migration changes.
