---
"@vintra/web": minor
---

Add an Excel export to the Purchase Order list: a single sheet with one row per PO line item (PO number in the first column, PO header repeated), following the on-screen filters. The server re-queries every matching PO with all its lines — the list only loads the latest 50 — capped at 2,000 POs with a warning past the cap. Ported from JuraganQu.
