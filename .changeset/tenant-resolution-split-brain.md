---
"@vintra/web": patch
---

Resolve the session to the same tenant in the UI and on the server.

`requireAuth` ordered its membership lookup by `createdAt`; `getCurrentUser` ran its
own `.limit(1)` with no `ORDER BY` at all. For anyone holding two memberships
Postgres was free to hand the two queries different rows — the page rendered as one
tenant while every server function authorised against another.

Both now share one exported ordering helper, `primaryMembershipOrder`, so a future
change cannot move one without the other. The ordering itself also changed from
plain oldest-first to **owned tenant first, oldest membership as the tie-break**.
The two differ exactly where it hurts: someone invited to an employer's shop before
opening their own would otherwise be pinned to the employer's tenant forever. Users
with a single membership resolve to precisely the row they did before.
