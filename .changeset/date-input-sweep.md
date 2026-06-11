---
"@vintra/web": patch
---

Sweep: every native `<input type="date">` across the app now renders as `dd/mm/yyyy`. Affected pages — cashflow ledger / dashboard / akun / bon / cicilan / entry sheet, POS sales / reports / cash sessions, inventory PO list / create-PO sheet, attendance records (filter + manual-entry form), booking settings, admin finance + tenant detail, plus the six admin payment / refund / outlet sheets. The `DateInput` component gained `label`, `error`, `max`, `min`, and `required` so it's a drop-in for the existing `<Input type="date">` calls.

The on-the-wire value stays ISO `yyyy-mm-dd` — zod schemas, server functions, query strings, and report exports all keep the same contract. RHF-registered fields are wired via `Controller`.
