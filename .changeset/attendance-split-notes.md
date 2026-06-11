---
"@vintra/web": patch
"@vintra/db": patch
---

Split attendance notes into separate clock-in and clock-out columns:

- DB migration 0007: drops `attendance_records.notes`, adds
  `clock_in_notes` + `clock_out_notes`. Backfill splits existing merged
  strings on the `\n— clock-out —\n` divider.
- `submitClockIn` / `submitClockOut` write to their respective columns
  independently — no more string merging / parsing.
- Records table cell + mobile card now render both notes with
  "Masuk:" / "Pulang:" labels.
- CSV + XLSX exports get two distinct columns: **Catatan Masuk** and
  **Catatan Pulang** (replaces the single Catatan column).

Known edge case: historical records where only clock-out had notes
(no divider in the stored string) were classified as clock-in notes
by the backfill. Easy to fix per-record via SQL if needed.
