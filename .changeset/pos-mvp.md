---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": minor
---

Add Phase 1 of the POS (Kasir) module — Free + Toko tiers shippable end-to-end:

**Schema (migration 0017_pos.sql)**: 4 new tables — `pos_settings` (per-tenant subscription/trial state + receipt customisation + tax + allowed payment methods), `pos_sales` (sale header with snapshot pricing + status enum + payment method enum), `pos_sale_items` (lines, optional FK to inventory_items, with hpp_at_sale snapshot for future margin reports), `pos_sale_counters` (atomic per-tenant sale-number counter, format `JQU-YYYY-NNNNN`).

**Server**: `requirePOSAccess` middleware mirroring inventory; `pos.ts` server functions (overview, cashier-masters, products, createSale atomic with stock movements + HPP snapshots, void with movement reversal, sales history with Free 30-day clamp, daily Z-report); `pos-receipt.ts` with jsPDF-based renderer for thermal-80mm + A4 receipt layouts and a 24h-presigned WhatsApp share URL; admin-finance extensions for `startPOSTrial`, `endPOSTrial`, `recordPOSPaymentAndActivate`, plus `recordRefund` dispatch widening for module=`pos`; 3 new scheduler ticks (trial reminder, subscription reminder, daily 23:30 Jakarta Z-report digest). Backwards-compatible widening of `inventory.recordMovement` to accept `referenceType` + `referenceId`.

**Pricing**: `POS_PLANS` constant (Free 50tx/day + 1 cashier + Tunai/QRIS only; Toko 79k/63k flat per tenant unlimited tx + 3 cashiers + all 5 payment methods + custom receipt + sale discount + customer capture + Z-report; Bisnis + Multi-Outlet declared with `comingSoon: true` for the landing tier picker). `POS_TRIAL_DEFAULTS` = 7 days Toko-tier.

**Notifications**: 9 POS-prefixed types (trial granted/expiring/expired, payment received, refund processed, sub expiring 7d/1d, daily Z-report ready, daily cap reached).

**UI**: 7 new tenant-side routes (`/pos`, `/pos/cashier` with desktop split + mobile tab UX, `/pos/sales` with date+status+method filters and Z-report download, `/pos/sales/$saleId` with receipt re-print + same-day void, `/pos/settings` for logo/footer/tax/methods, `/pos/billing` 4-tier card grid, `/pos/locked`). Cashier components: product grid with category chips + stock badges, cart with qty steppers + sale-level discount + customer fields, payment modal with method picker + change calc + quick-amount presets, ad-hoc line modal, sale-success modal with WA share + PDF download + print. Admin-side `<POSModuleSection />` mounted in tenant detail page with Aktifkan/Perpanjang/Nonaktifkan + Mulai Trial flows.

**Landing**: 4th pricing tab "Kasir (POS)" with the matching tier-card grid; `MODULES.pos` already declared at 79000.

**Integration**: every POS sale line with an `item_id` writes an `inventory_movements` row (`movement_type='out'`, `reference_type='pos_sale'`, `reference_id=<sale_id>`) and decrements `inventory_stock_balances` atomically; void reverses with compensating `'in'` movements (`reason='pos_void'`). HPP snapshot at sale time pulls from `inventory_items.linked_hpp_product_id → products.hpp` (falls back to item cost) — forward-compat for the deferred margin report. New `jspdf` dependency.
