---
"@vintra/web": minor
---

Grant 3 free Konten credits on a tenant's first paid Komplit bundle activation. Lives inside the `posRecordPayment` transaction so the grant rolls back with the rest if the payment record fails. Once per tenant for the tenant's lifetime — idempotency is enforced via a new `signup_grant` ledger type, so cancellation and re-subscription do NOT trigger a second grant.
