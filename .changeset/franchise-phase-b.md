---
"@vintra/web": minor
---

Franchise / Independent — Phase B. The branch create/edit form (`/master/branches`) gains a model picker — Independent or Franchise — for non-main branches; `createBranch`/`updateBranch` persist it, and the server forces the main branch (HQ) to always be `independent`.

Assigning a franchisee works through the existing team-member form: give the member the `outlet_owner` ("Pemilik Outlet") role and pin them to the franchise branch. New non-owner members already default to branch-locked (JUR-135), so a kasir can't reach another branch's money.
