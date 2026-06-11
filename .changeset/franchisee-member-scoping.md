---
"@vintra/web": patch
---

Franchisee branch-scoped member management. A branch-restricted member (a Pemilik Outlet / `outlet_owner`) can now only manage staff of the branch they run: `listTenantMembers` hides members of other branches, and invite / profile-edit / role-change / remove / branch-reassign all reject a member outside the caller's branch. A scoped caller also can't invite an all-branches member or assign a branch they don't control. Owners and admins (unrestricted) are unaffected.
