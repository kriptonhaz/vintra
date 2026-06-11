---
"@vintra/web": patch
---

Fix "Expected number, received string" when saving branch working
hours. `<Input type="number">` values are DOM strings; react-hook-form
stored them as strings in form state even though the Zod schema uses
`z.coerce.number()` during validation. `getValues()` returns the raw
form state, so we were sending strings to `setBranchSchedule` /
`updateBranch`, which expect real numbers.

Two fixes layered together:
- Schedule tab grace-minutes input now registers with
  `{ valueAsNumber: true }` so react-hook-form stores it as a number.
- Payload builders for both tabs wrap number fields in `Number(...)`
  as a safety net (lateGraceMinutes, earlyLeaveGraceMinutes, latitude,
  longitude, radiusMeters).
