---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Move the per-member branch-access editor out of the inline-popover chip on the members table and into the existing `EditProfileSheet` (the slide-in details panel triggered by clicking a row). The cramped popover anchored to the table cell was hard to use on narrow viewports; the sheet has room to breathe.

The table cell is now display-only (chip with branch name or count + tooltip listing all assigned branches). All editing — name, photo, *and* branch access — happens in one place. The sheet saves profile + branch changes together; branch update only fires when the picker draft actually differs from the saved state so the common "renamed the phone number" path stays a single write.

No backend changes; reuses the existing `setTenantMemberBranches` server fn and `BranchAccessPicker` component.
