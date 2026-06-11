---
"@vintra/web": minor
---

Attendance Phase 2b — owner-facing reports + UX polish:

- New `/attendance/records` page with date-range / staff / branch filters
  and Excel (xlsx) + CSV export via a single Download dropdown
- 25-per-page server-side pagination (LIMIT/OFFSET + COUNT) — pagination
  footer always visible
- Mobile-friendly card layout below the `sm` breakpoint (no horizontal
  scroll); table preserved at sm+ with new "Catatan" column
- Records show late/early-leave duration in minutes (e.g.
  `terlambat · +15 menit`); status string localized (on_time → tepat
  waktu, late → terlambat, etc.)
- Optional notes textarea on the staff check-in form (500 char limit);
  clock-out notes append with a divider so both events' notes survive
- Attendance dashboard rewritten with today's on-time/late/absent/
  clocked-out cards, a 7-day stacked bar chart (pure CSS/SVG), and a
  top-late-staff list for the current month
- New `/admin/storage` page for platform admins: total bucket size,
  count, recent photos table with thumbnails, delete control, and a
  reusable `ImagePreviewModal` (replaces `target="_blank"` previews on
  both the storage page and the records page)
- s3-storage.ts gains `listAttendanceObjects`, `deleteAttendancePhoto`,
  `parseAttendanceKey` helpers; required IAM policy now includes
  `s3:ListBucket` on the bucket ARN (in addition to object ops)
- Removed the outdated "fitur clock-in/out sedang dikembangkan"
  banner from the attendance dashboard
- Adds `xlsx` dep for the Excel export
