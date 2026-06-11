---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Close the last 3 Inventory Phase 1 gaps so it can be declared done.

**HPP downlink** — when an HPP material price changes, fire a notification (`inventory_hpp_cost_changed`) to the editor with material name, old/new price, and linked-item count. URL deeplinks to `/inventory/items?applyHpp=<materialId>`, where a new `<ApplyHppBanner>` surfaces the change and offers a one-click bulk update via the new `applyHppPriceToInventory` server fn. Includes a `previewLinkedItemsForMaterial` fn so the banner can show what would change before the user clicks apply, and a soft "all in sync" state when there's nothing to update. Idempotent (60-second `sourceKey` window) so quick double-saves don't spam two notifications.

**Inventory refund** — generalized the existing `recordRefund` server fn to dispatch by `original.moduleKey`. Inventory refunds now correctly update `inventorySettings.subscription_active`, remove `'inventory'` from `tenants.activeModules`, fire the `inventoryRefundProcessed` notification, and email a billing-page-specific link. The TransactionsTable refund button on the admin tenant detail page already worked module-agnostically — the server-side dispatch closes the loop without any UI changes.

**Per-item HPP-sync toggle** — new `auto_sync_hpp_cost boolean NOT NULL DEFAULT true` column on `inventory_items` (migration `0016`). Wired into the item create + edit forms as a checkbox that only renders when an HPP material is linked. The `recordMovement` HPP uplink branch and `applyHppPriceToInventory` downlink both AND-gate on this flag, so power users can keep the link visible (for traceability / discoverability) while opting out of auto-sync per item.

i18n: 9 new keys covering the toggle label/hint, banner title/body/skipped/CTA, success toast, and the "all in sync" copy.
