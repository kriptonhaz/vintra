---
"@vintra/web": minor
"@vintra/db": minor
---

Add attendance "simple mode" — an optional per-branch work schedule. A branch can now run without a fixed schedule: staff clock in/out any time and records are saved with a neutral "present" status instead of on-time/late scoring.

- New `branches.requires_schedule` column (defaults to `true`, so every existing branch keeps its current schedule-backed behavior unchanged).
- New branches are created in simple mode; the owner opts into a fixed schedule from the branch form's schedule tab, which seeds the default Mon-Fri rows on demand.
- The check-in page and clock-in/out flow allow free clock-in on simple-mode branches.
- The attendance dashboard shows plain presence counts (Hadir / Belum hadir / Sudah pulang) and hides the on-time/late chart when no branch uses a schedule.
