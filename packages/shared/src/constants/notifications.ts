/**
 * Notification type registry. Stored as text in the DB; this constant
 * is the single source of truth for known values. Adding a new type:
 *
 *   1. Add a key here.
 *   2. Add an icon mapping in the bell/notifications-page renderer.
 *   3. Add an i18n string for the type label if you want default copy.
 *
 * Why a const-as-record instead of an enum: keeps tree-shaking friendly
 * and avoids the runtime overhead of TS enums.
 */
export const NOTIFICATION_TYPES = {
  trialGranted: 'attendance_trial_granted',
  trialExpiringSoon: 'attendance_trial_expiring',
  trialExpired: 'attendance_trial_expired',
  paymentReceived: 'payment_received',
  refundProcessed: 'refund_processed',
  subExpiringSoon7d: 'attendance_sub_expiring_7d',
  subExpiringSoon1d: 'attendance_sub_expiring_1d',
  clockInReminder: 'clockin_reminder',
  clockOutReminder: 'clockout_reminder',
  adminBroadcast: 'admin_broadcast',

  // Inventory module
  inventoryTrialGranted: 'inventory_trial_granted',
  inventoryTrialExpiringSoon: 'inventory_trial_expiring',
  inventoryTrialExpired: 'inventory_trial_expired',
  inventoryPaymentReceived: 'inventory_payment_received',
  inventoryRefundProcessed: 'inventory_refund_processed',
  inventorySubExpiringSoon7d: 'inventory_sub_expiring_7d',
  inventorySubExpiringSoon1d: 'inventory_sub_expiring_1d',
  inventoryLowStock: 'inventory_low_stock',
  /**
   * Fires when an HPP material's price changes and one or more
   * inventory items are linked to it. The notification body lists the
   * old/new price + linked-item count; the URL deeplinks to the
   * inventory items page with `?applyHpp=<materialId>` so the user
   * sees a one-click "apply to all" banner.
   */
  inventoryHppCostChanged: 'inventory_hpp_cost_changed',

  /**
   * Fires after a stock-in silently repriced one or more HPP products,
   * because receiving goods changed a linked ingredient's cost.
   *
   * The cascade itself is deliberately silent — the crew receiving goods are
   * not the people who set menu prices, and a confirmation dialog there asks
   * a question they cannot answer. This is how the owner finds out, after
   * the fact, with the count of products affected and how many fell below a
   * healthy margin.
   */
  hppCascaded: 'hpp_cascaded',

  // POS module
  posTrialGranted: 'pos_trial_granted',
  posTrialExpiringSoon: 'pos_trial_expiring',
  posTrialExpired: 'pos_trial_expired',
  posPaymentReceived: 'pos_payment_received',
  posRefundProcessed: 'pos_refund_processed',
  posSubExpiringSoon7d: 'pos_sub_expiring_7d',
  posSubExpiringSoon1d: 'pos_sub_expiring_1d',
  /**
   * Daily 23:30 Jakarta tick. Toko+ only. Body = "Z-Report siap untuk
   * <date>: <txCount> transaksi, total <Rp>. Lihat detail."; URL
   * deeplinks to /pos/sales?date=<date>.
   */
  posDailyZReportReady: 'pos_daily_zreport_ready',
  // `posDailyCapReached` was removed when the Free tier's 50/day
  // transaction cap was lifted. Kept here as a graveyard comment so
  // anyone hunting for the old notification type knows where it went.

  /**
   * JUR-10: fires when a sale hits an HPP material that has no
   * inventory item linked as its stock-tracker. The auto-deduction
   * silently skips that material — without this notification the
   * owner thinks deduction works but doesn't realise stock is leaking.
   * Idempotent per (tenant, material) via `sourceKey =
   * "pos_unlinked_material:<material_id>"` so a kafe with 5 unlinked
   * materials gets exactly 5 notifications, not one per sale.
   */
  posUnlinkedMaterial: 'pos_unlinked_material',

  /**
   * JUR-10: fires when a sale's BOM includes a sub-product (nested
   * recipe) — v1 doesn't recurse into those, so the notification
   * informs the owner that "X bahan dari sub-resep belum auto-deduct".
   * Idempotent per (tenant, parent product) so a kafe selling the
   * same drink 50× a day doesn't get spammed.
   */
  posNestedRecipeSkipped: 'pos_nested_recipe_skipped',

  // Cashflow — Cicilan (JUR-158)
  cicilanDueSoon: 'cicilan_due_soon',

  // Comp grants (JUR-194) — a non-founder admin requested free access.
  compRequestPending: 'comp_request_pending',

  // Feedback / support
  feedbackNewThread: 'feedback_new_thread',
  feedbackTenantReply: 'feedback_tenant_reply',
  feedbackAdminReply: 'feedback_admin_reply',
} as const

export type NotificationTypeKey = keyof typeof NOTIFICATION_TYPES
export type NotificationType = typeof NOTIFICATION_TYPES[NotificationTypeKey]
