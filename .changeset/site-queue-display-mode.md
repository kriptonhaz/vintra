---
"@vintra/web": patch
---

JUR-176 queue section: fix truncation + add aggregate display mode.

- Section title and per-staff name no longer truncate. Moved the
  title off the flex-with-LIVE-badge row so it has full width to
  wrap; staff name uses `overflow-wrap: anywhere` + container-query
  font scaling instead of `truncate`.
- New `displayMode` setting:
  - `per-staff` (default): one card per resource — fits salon /
    barbershop where customers pick a stylist.
  - `aggregate`: single big number for total waiting + pill-stats
    (`X sedang dikerjakan`, `Y staf aktif`, `Z jeda`) — fits cuci
    motor / klinik walk-in where staff assignment is internal.
- Walk-in preset now defaults to `aggregate` so new cuci-motor
  tenants get the right experience without configuring.
- No change to `booking_settings` — the underlying scheduler still
  tracks per-resource for auto-routing. This setting only controls
  how the public page summarizes.
