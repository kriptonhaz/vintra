---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

`<DateInput>` now ships with a calendar popover. A calendar icon button sits inside the right edge of the input; clicking it opens a month grid (Indonesian month + weekday names, Sunday-start) with prev/next month navigation, "Hari ini" quick-pick, "Hapus" clear, today highlight, selected-date highlight, and disabled cells outside the existing `min`/`max` range. Outside-click closes. The strict dd/mm/yyyy text mask stays for users who prefer typing — both paths emit the same ISO `yyyy-mm-dd` so every existing call site (POS sales filter, POS reports range, cash sessions, etc.) gets the new picker automatically with no usage change.
