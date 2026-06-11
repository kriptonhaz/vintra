---
"@vintra/web": minor
---

Pengumuman (announcements) — Phase 2 + fixes.

- **Separated from the notification bell.** Announcements are now their own channel: a new `announcement_reads` table tracks per-user read state, publishing no longer fans out notification rows, and the existing fanned-out rows are cleaned up (migration `0116`). The bell is system-only again.
- **Edit + expiry.** The web admin can edit an announcement (title/body/pin/expiry) and set a "Tampil sampai" date; expired announcements auto-hide from staff (backend already filtered; the form now exposes the field). Admin list is paginated.
- **Mobile.** Pull-to-refresh on the home (and the new Pengumuman list screen); the home card shows the top 3 with a "Lihat semua (N)" link into a dedicated full-feed screen; the sales-chart card is shorter and the home hides its scroll indicator.
- **Fix: stale data across account switches.** Logging in as a different user (or logging out) now clears the React Query cache and the POS cart, so the new session never sees the previous user's cached data (queries are keyed by tenant, which two users can share).
