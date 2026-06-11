---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

POS customer DB redesign:

- Move `Pelanggan` from POS subnav to sidebar Master Data section (`/master/customers`) — it's tenant-wide reference data, not POS-specific.
- Replace the always-visible inline customer card in the cashier cart with a compact button (no customer attached) or chip with detach (when attached). Clicking opens a phone-first picker modal (Alfamart-style): cashier types phone → existing matches surface, or inline create form lets cashier register + attach in one step. Walk-in skip button rings sale without a customer.
- Expose POS feature flags via `getCurrentUser` so the sidebar can hide `Pelanggan` for tenants without `customer_db`.
