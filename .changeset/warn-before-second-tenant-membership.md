---
"@vintra/web": patch
"@vintra/shared": patch
---

Warn before someone quietly ends up in two tenants.

Signing up with Google on an account that already belonged to a business never
created a second tenant — `UNIQUE(tenants.owner_id)` makes that impossible — but it
said nothing either. The person who pressed "Daftar" landed inside their employer's
shop with no explanation. `ensureTenantForOAuth` now returns which tenant and role
they already hold, and the callback shows that instead of a silent redirect to
/dashboard.

Only on the register path. `login.tsx` and `register.tsx` pass an identical
`redirectTo`, so the two are indistinguishable once Google redirects back; without a
marker the notice would greet every staff member on every login. A short-lived
`vtr_signup` cookie, set only by the register button, carries the intent across the
round-trip.

Inviting someone who already works at another tenant now needs an explicit yes.
`checkInviteEmailMemberships` gives the invite sheet the tenant names for its dialog,
and `inviteTenantMember` rejects an unconfirmed invite server-side rather than
trusting the UI. The invited person also gets a `member_added_to_tenant` notification
— web has no tenant switcher yet, so a second membership is otherwise invisible to
the one who gained it, and tenant resolution puts an owned tenant ahead of it.

Guard applies to the email path only. Phone-only invites derive a synthetic
`wa-{slug}-{phone}` address and `tenants.slug` is unique, so that user can never
belong to another tenant.

The mobile invite path is unchanged and will reject these invites until it sends the
new `confirmExistingMemberships` flag.
