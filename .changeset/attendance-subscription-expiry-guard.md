---
"@vintra/web": patch
---

Attendance module: block access when the subscription has expired.
Previously `requireActiveModule('attendance')` only checked the
`tenants.activeModules` array, so a tenant whose
`subscription_expires_at` had passed could still add staff, clock in,
and edit settings as if nothing had changed.

Now the server middleware and the `/attendance` layout-route guard
both check that `subscriptionActive = true` AND `subscriptionExpiresAt
> now`. Expired tenants get redirected to `/attendance/locked`, which
displays a dedicated "Langganan Berakhir" message with the exact
expiry date. Dashboard card on the tenant home also hides the
attendance quick-link when expired.

`getCurrentUser` now includes `moduleSubscriptions.attendance`
(`{ active, expiresAt, isExpired }`) on the user context so client
guards can decide without an extra roundtrip. If future paid modules
are added, the pattern can be extended to track their expiry
similarly.
