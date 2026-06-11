---
"@vintra/db": minor
---

Phase 3 — WhatsApp per-branch foundation. Add a nullable `branch_id` to `wa_instances` (migration `0090`) so a franchise can run a separate WhatsApp number per outlet, sold as a per-branch add-on. Existing instances stay tenant-level (`branch_id` null).

This is the schema foundation only. `wa_instances` is owned by the Go API (`apps/api`, sqlc); the column is inert until the Go create-handler is taught to populate it and the per-branch entitlement check (against `branches.enabled_modules`) is added — tracked as cross-service follow-up.
