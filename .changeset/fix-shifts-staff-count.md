---
"@vintra/web": patch
---

Fix the staff count in the attendance shifts table not matching the staff actually listed in the shift's staff sheet. The table's count was filtering on `isActive = true` while the staff sheet shows every assigned profile (with inactive ones rendered dimmed), so a shift with one active and one deactivated assignee displayed "1" in the badge but "2" in the sheet. Count now includes all assigned profiles to match.
