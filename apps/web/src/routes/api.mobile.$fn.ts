/**
 * Mobile REST gateway — turns TanStack Start's internal RPC server
 * functions into externally-callable JSON endpoints for the React
 * Native app.
 *
 * Why this exists: server fns in TanStack Start v1.160 don't expose
 * a stable HTTP URL (they're called via a build-time-generated hash
 * meant for same-bundle RPC). Mobile clients can't import them, so
 * we wrap a hand-curated allowlist in a regular route handler.
 *
 * URL: POST /api/mobile/<fn>
 * Body: { data: <payload> }
 * Headers: Authorization: Bearer <supabase-jwt>
 *          X-Tenant-Id: <uuid>  (optional; respected by requireAuth)
 *
 * Each entry in HANDLERS calls the matching server fn's _server-fn
 * directly. Adding a new endpoint = one line in the allowlist.
 *
 * Security: the JWT validation lives inside each underlying server
 * fn (via `requireAuth` / `requireActiveModule`). The gateway does
 * NOT add its own auth — it's a pure dispatcher. Forged headers still
 * get rejected by the wrapped server fn.
 */
import { createFileRoute } from '@tanstack/react-router'
import {
  listMyTenants,
  getCurrentUser,
  registerWithEmail,
} from '@/server/functions/auth'
import {
  getMyTodayStatus,
  submitClockIn,
  submitClockOut,
  getMyAttendanceHistory,
  getAttendanceTodayOverview,
} from '@/server/functions/attendance-checkin'
import { listAccessibleBranches } from '@/server/functions/attendance-branches'
import {
  getAttendanceDashboardStats,
  getAttendanceOverview,
  getMyBillingHistory,
  updateModeToggles,
  updateQrRotation,
  updateAttendanceReminderSettings,
} from '@/server/functions/attendance-settings'
import { listAttendanceRecords } from '@/server/functions/attendance-records'
import {
  listStaff as listAttendanceStaffFn,
  getStaffQuota,
  setStaffActive,
} from '@/server/functions/attendance-staff'
import {
  listShifts,
  getShiftWithSchedule,
  createShift,
  updateShift,
  deleteShift,
  setShiftSchedule,
  setStaffShift,
} from '@/server/functions/attendance-shifts'
import {
  startQrHost,
  rotateQrToken,
  stopQrHost,
} from '@/server/functions/attendance-qr-host'
import {
  getPOSCashierMasters,
  listPOSProducts,
  createSale,
  getPOSOverview,
  getSalesSeries,
  getPOSSettings,
  getCustomerLoyaltySummary,
  listSales,
  getDailyZReport,
  getSale,
  voidSale,
  updatePOSSettings,
  uploadReceiptLogo,
  updateBranchReceipt,
  updatePOSCashSettings,
} from '@/server/functions/pos'
import {
  listVoidCategories,
  createVoidCategory,
  updateVoidCategory,
} from '@/server/functions/pos-void-categories'
import {
  listPromotions,
  upsertPromotion,
  deactivatePromotion,
  listSellablePromoProducts,
  listPromoCategories,
} from '@/server/functions/promotions'
import {
  listStampPrograms,
  getStampFormMasters,
  createStampProgram,
  updateStampProgram,
  deleteStampProgram,
  getStampActivity,
} from '@/server/functions/loyalty-stamps'
import { getPrepWasteReport } from '@/server/functions/pos-prep'
import {
  createFeedbackThread,
  addFeedbackMessage,
  listFeedbackThreads,
  getFeedbackThread,
} from '@/server/functions/feedback'
import {
  searchCustomersByPhone,
  upsertCustomer,
  listCustomers,
  getCustomer,
  deleteCustomer,
} from '@/server/functions/customers'
import {
  exportCustomers,
  importCustomers,
} from '@/server/functions/customers-io'
import {
  getRolesForAssignment,
  listTenantMembers,
  inviteTenantMember,
  updateTenantMemberProfile,
  updateTenantMemberRole,
  removeTenantMember,
  listTenantBranchesForMembers,
  setTenantMemberBranches,
  invitePhoneOnlyTenantMember,
  setTenantMemberWaLogin,
  getTenantSlugForWaLogin,
  getWaLoginAvailability,
} from '@/server/functions/tenant-members'
import {
  listTenantRoles,
  listAllPermissions,
  createTenantRole,
  updateTenantRole,
  deleteTenantRole,
} from '@/server/functions/tenant-roles'
import {
  listBranches as listMasterBranches,
  getBranchWithSchedule,
  getBranchManagementContext,
  createBranch,
  updateBranch,
  deleteBranch,
  setBranchSchedule,
  setBranchScheduleMode,
  getBranchBusinessHours,
  setBranchBusinessHours,
} from '@/server/functions/attendance-branches'
import {
  createAnnouncement,
  updateAnnouncement,
  listAnnouncementsAdmin,
  deleteAnnouncement,
} from '@/server/functions/announcements'
import {
  changePassword,
  setPassword as setAuthPassword,
} from '@/server/functions/auth'
import {
  updateSupplier,
  deleteSupplier,
  updateTenantCategory,
  deleteTenantCategory,
} from '@/server/functions/hpp'
import {
  getMyCommissionSummary,
  listMyCommissions,
  listMyClaimRequests,
  getMyPayoutMethod,
  upsertPayoutMethod,
  submitClaimRequest,
} from '@/server/functions/referral-tenant'
import {
  getReferralCap,
  listMyReferralCodes,
  createReferralCode,
  updateReferralCode,
  toggleReferralCode,
  listMyAttributions,
} from '@/server/functions/referrals'
import { completeOnboarding } from '@/server/functions/auth'
import {
  getMyKontenLedger,
  getKontenStatus,
  getKontenPromptConfig,
  listKontenImages,
  generateKontenImage,
  getKontenImageDownloadUrl,
  deleteKontenImage,
} from '@/server/functions/konten'
import {
  getLogoStatus,
  getLogoPromptConfig,
  listLogos,
  generateLogo,
  getLogoDownloadUrl,
  deleteLogo,
} from '@/server/functions/logo'
import {
  getSpandukStatus,
  getSpandukConfig,
  listSpanduks,
  deleteSpanduk,
  getSpandukDownloadUrl,
  generateSpanduk,
  commitSpandukPreview,
} from '@/server/functions/spanduk'
import {
  listStudioGenerations,
  getStudioDownloadUrl,
  deleteStudioGeneration,
} from '@/server/functions/studio'
import { getCustomerStampCards } from '@/server/functions/loyalty-stamps'
import { listActivePromotions } from '@/server/functions/promotions'
import { getSaleReceiptPDF } from '@/server/functions/pos-receipt'
import {
  getActiveCashSession,
  openCashSession,
  recordCashDrop,
  recordCashPayout,
  closeCashSession,
  listCashSessions,
  getCashSessionDetail,
} from '@/server/functions/pos-cash'
import {
  requestWaLoginOtp,
  verifyWaLoginOtp,
} from '@/server/functions/wa-login'
import {
  listNotifications,
  getRecentNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
} from '@/server/functions/notifications'
import {
  getInventoryOverview,
  listInventoryItems,
  listInventoryBranches,
  // Phase C — item CRUD + stock movement + form masters
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deactivateInventoryItem,
  recordMovement,
  listInventoryFormMasters,
  // Phase D — mobile gap-fill (movements ledger + bulk import + branches)
  listInventoryMovements,
  getItemMovementUnits,
  deleteMovement,
  getHppImportCandidates,
  bulkCreateInventoryItemsFromHpp,
  createInventoryBranch,
} from '@/server/functions/inventory'
import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  receivePurchaseOrder,
  listItemsForPO,
} from '@/server/functions/inventory-po'
// Phase C — JUR-190 inter-branch requisitions
import {
  createRequisition,
  listRequisitions,
  getRequisition,
  approveRequisition,
  rejectRequisition,
  cancelRequisition,
  fulfillRequisition,
} from '@/server/functions/inventory-requisitions'
import {
  getCashflowTodaySummary,
  listCashflowCategories,
  // Phase D — full cashflow module
  getCashflowOverview,
  createCashflowCategory,
  updateCashflowCategory,
  deleteCashflowCategory,
  listCashflowBranches,
  listCashflowEntries,
  createCashflowEntry,
  updateCashflowEntry,
  deleteCashflowEntry,
} from '@/server/functions/cashflow'
import {
  listCashflowAccounts,
  createCashflowAccount,
  updateCashflowAccount,
  deleteCashflowAccount,
  listCashflowTransfers,
  createCashflowTransfer,
} from '@/server/functions/cashflow-accounts'
import {
  listPayables,
  createPayable,
  markInstallmentPaid,
  togglePayableReminders,
  listCicilanSuppliers,
} from '@/server/functions/cashflow-ap'
import {
  listReceivables,
  listArCustomerOptions,
  getReceivablePayments,
  createReceivable,
  recordArPayment,
} from '@/server/functions/cashflow-ar'
import {
  getCashflowDashboard,
} from '@/server/functions/cashflow-dashboard'
import {
  getMySiteSettings,
  publishSite,
  setSiteMaintenanceMode,
  listSitePublishHistory,
} from '@/server/functions/tenant-site'
import { claimPublicSlug } from '@/server/functions/public-tenant'
import { getSiteAnalyticsSummary } from '@/server/functions/site-analytics'
import {
  getBookingSettings,
  getBookingResources,
  getBookingServices,
  getBookings,
  listBookingBranches,
  searchBookingCustomers,
  createBooking,
  updateBookingStatus,
  updateBooking,
  deleteBooking,
  getBookingSettingsState,
  saveBookingSettings,
  toggleMemberBookable,
  addBookingStaff,
  deleteBookingResource,
} from '@/server/functions/booking'
import {
  listWaInstances,
  connectWaInstance,
  pairWaInstanceWithCode,
  disconnectWaInstance,
  getWaInstanceStatus,
  createWaInstance,
  deleteWaInstance,
  sendWaMessage,
  listWaMessages,
  listWaContacts,
  markWaContactRead,
  getWaInstance,
  updateWaInstance,
  sendWaImage,
  getWaMediaUrl,
  updateContactHandoff,
  getAiMonthlyUsage,
  getWaSubscription,
} from '@/server/functions/whatsapp'
import {
  listAnnouncements,
  getAnnouncement,
} from '@/server/functions/announcements'
import {
  getTenantCategories,
  createTenantCategory,
  getSuppliers,
  findOrCreateSupplier,
  getMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  duplicateProduct,
  getProductForEdit,
  replaceProductMaterials,
  calculateProductHpp,
  setProductHpp,
  getHppReport,
  getHppPhotoUrls,
} from '@/server/functions/hpp'
import { getHppUnits } from '@/server/functions/master-data'

// Wrap each server fn so the gateway can invoke it with a unified
// `data` arg shape. Server fns with no input (e.g. listMyTenants)
// ignore the arg.
const HANDLERS: Record<string, (data: unknown) => Promise<unknown>> = {
  // Auth + tenants
  listMyTenants: async () => await listMyTenants(),
  getCurrentUser: async () => await getCurrentUser(),

  // Global outlet (branch) switcher — returns the branches the current
  // member can operate plus the tenant's total active count (so the UI
  // can distinguish single-branch tenant from scoped staff).
  listAccessibleBranches: async () => await listAccessibleBranches(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerWithEmail: async (data: any) => await registerWithEmail({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestWaLoginOtp: async (data: any) => await requestWaLoginOtp({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  verifyWaLoginOtp: async (data: any) => await verifyWaLoginOtp({ data }),

  // Attendance
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMyTodayStatus: async (data: any) => await getMyTodayStatus({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submitClockIn: async (data: any) => await submitClockIn({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  submitClockOut: async (data: any) => await submitClockOut({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMyAttendanceHistory: async (data: any) =>
    await getMyAttendanceHistory({ data }),
  getAttendanceTodayOverview: async () =>
    await getAttendanceTodayOverview(),

  // Manager-side attendance views (mirrors web /attendance + /attendance/records).
  // Permission gating lives inside each fn (`attendance.manage`); the mobile
  // tab only calls these when the active member holds that permission.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAttendanceDashboardStats: async (data: any) =>
    await getAttendanceDashboardStats({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listAttendanceRecords: async (data: any) =>
    await listAttendanceRecords({ data }),
  listAttendanceStaff: async () => await listAttendanceStaffFn(),

  // POS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPOSCashierMasters: async (data: any) =>
    await getPOSCashierMasters({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listPOSProducts: async (data: any) => await listPOSProducts({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSale: async (data: any) => await createSale({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPOSOverview: async (data: any) =>
    await getPOSOverview({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSalesSeries: async (data: any) =>
    await getSalesSeries({ data: data ?? {} }),
  // POS settings — exposes loyalty earn/redeem rates the cashier UI needs
  // to project points + render the redeem slider on checkout.
  getPOSSettings: async () => await getPOSSettings(),

  // Customer lookup + create-on-the-fly for the checkout customer picker.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchCustomersByPhone: async (data: any) =>
    await searchCustomersByPhone({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsertCustomer: async (data: any) => await upsertCustomer({ data }),

  // Loyalty: points balance + recent movements for the attached customer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCustomerLoyaltySummary: async (data: any) =>
    await getCustomerLoyaltySummary({ data }),
  // Stamp cards (one per active program) for the attached customer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCustomerStampCards: async (data: any) =>
    await getCustomerStampCards({ data }),

  // Active auto-promos (item / product_set / category / cart triggers) —
  // mobile cart computes per-line discount locally to render the
  // breakdown before checkout. Server re-resolves on createSale.
  listActivePromotions: async () => await listActivePromotions(),

  // Peti Kas (cash sessions)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getActiveCashSession: async (data: any) =>
    await getActiveCashSession({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openCashSession: async (data: any) => await openCashSession({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordCashDrop: async (data: any) => await recordCashDrop({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordCashPayout: async (data: any) => await recordCashPayout({ data }),
  // Expense categories for the Tarik Tunai picker (curated under Arus Kas).
  listCashflowCategories: async () => await listCashflowCategories(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  closeCashSession: async (data: any) => await closeCashSession({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSaleReceiptPDF: async (data: any) => await getSaleReceiptPDF({ data }),

  // POS sales history + Z-report (daily end-of-day report)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listSales: async (data: any) => await listSales({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDailyZReport: async (data: any) => await getDailyZReport({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSale: async (data: any) => await getSale({ data }),

  // Feedback / Help — tenant-side conversations with platform admin.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFeedbackThread: async (data: any) =>
    await createFeedbackThread({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addFeedbackMessage: async (data: any) =>
    await addFeedbackMessage({ data }),
  listFeedbackThreads: async () => await listFeedbackThreads(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getFeedbackThread: async (data: any) => await getFeedbackThread({ data }),

  // Notifications — drives the bell badge + the /notifications screen.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listNotifications: async (data: any) =>
    await listNotifications({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRecentNotifications: async (data: any) =>
    await getRecentNotifications({ data: data ?? {} }),
  getUnreadCount: async () => await getUnreadCount(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markNotificationRead: async (data: any) =>
    await markNotificationRead({ data }),
  markAllNotificationsRead: async () => await markAllNotificationsRead(),

  // Pengumuman (announcements) — read-side for the home card + detail.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listAnnouncements: async (data: any) =>
    await listAnnouncements({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAnnouncement: async (data: any) => await getAnnouncement({ data }),

  // Owner-home widgets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getInventoryOverview: async (data: any) =>
    await getInventoryOverview({ data: data ?? {} }),
  getCashflowTodaySummary: async () => await getCashflowTodaySummary(),

  // Inventory list (Phase B — read-only list + low-stock filter)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listInventoryItems: async (data: any) =>
    await listInventoryItems({ data }),
  listInventoryBranches: async () => await listInventoryBranches(),

  // Inventory CRUD (Phase C — items + stock movements)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getInventoryItem: async (data: any) => await getInventoryItem({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createInventoryItem: async (data: any) =>
    await createInventoryItem({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateInventoryItem: async (data: any) =>
    await updateInventoryItem({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deactivateInventoryItem: async (data: any) =>
    await deactivateInventoryItem({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordMovement: async (data: any) => await recordMovement({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listInventoryFormMasters: async (data: any) =>
    await listInventoryFormMasters({ data: data ?? {} }),

  // Inter-branch requisitions (Phase C — JUR-190 mobile mirror)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createRequisition: async (data: any) => await createRequisition({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listRequisitions: async (data: any) =>
    await listRequisitions({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRequisition: async (data: any) => await getRequisition({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  approveRequisition: async (data: any) =>
    await approveRequisition({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rejectRequisition: async (data: any) =>
    await rejectRequisition({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cancelRequisition: async (data: any) =>
    await cancelRequisition({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fulfillRequisition: async (data: any) =>
    await fulfillRequisition({ data }),

  // ── HPP module ──────────────────────────────────────────────────
  // Master pickers (units come from master-data; categories per tenant)
  getHppUnits: async () => await getHppUnits(),
  getTenantCategories: async () => await getTenantCategories(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createTenantCategory: async (data: any) =>
    await createTenantCategory({ data }),

  // Suppliers (used by wizard's inline supplier creation)
  getSuppliers: async () => await getSuppliers(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findOrCreateSupplier: async (data: any) =>
    await findOrCreateSupplier({ data }),

  // Materials CRUD (wizard inline material create + future materials page)
  getMaterials: async () => await getMaterials(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createMaterial: async (data: any) => await createMaterial({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateMaterial: async (data: any) => await updateMaterial({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteMaterial: async (data: any) => await deleteMaterial({ data }),

  // Products CRUD + BOM
  getProducts: async () => await getProducts(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getProduct: async (data: any) => await getProduct({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createProduct: async (data: any) => await createProduct({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateProduct: async (data: any) => await updateProduct({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteProduct: async (data: any) => await deleteProduct({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  duplicateProduct: async (data: any) => await duplicateProduct({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getProductForEdit: async (data: any) => await getProductForEdit({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replaceProductMaterials: async (data: any) =>
    await replaceProductMaterials({ data }),

  // HPP calc + reporting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  calculateProductHpp: async (data: any) =>
    await calculateProductHpp({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setProductHpp: async (data: any) => await setProductHpp({ data }),
  getHppReport: async () => await getHppReport(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getHppPhotoUrls: async (data: any) => await getHppPhotoUrls({ data }),

  // ── POS module — sale detail, cash sessions, settings, etc. ─────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  voidSale: async (data: any) => await voidSale({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatePOSSettings: async (data: any) => await updatePOSSettings({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uploadReceiptLogo: async (data: any) => await uploadReceiptLogo({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBranchReceipt: async (data: any) =>
    await updateBranchReceipt({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updatePOSCashSettings: async (data: any) =>
    await updatePOSCashSettings({ data }),

  // Void categories (used by void sale modal + settings)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listVoidCategories: async (data: any) =>
    await listVoidCategories({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createVoidCategory: async (data: any) => await createVoidCategory({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateVoidCategory: async (data: any) => await updateVoidCategory({ data }),

  // Cash sessions history (standalone screen, not active-session)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listCashSessions: async (data: any) =>
    await listCashSessions({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCashSessionDetail: async (data: any) =>
    await getCashSessionDetail({ data }),

  // Promotions CRUD (Komplit tier — gated server-side)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listPromotions: async (data: any) =>
    await listPromotions({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsertPromotion: async (data: any) => await upsertPromotion({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deactivatePromotion: async (data: any) =>
    await deactivatePromotion({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listSellablePromoProducts: async (data: any) =>
    await listSellablePromoProducts({ data: data ?? {} }),
  listPromoCategories: async () => await listPromoCategories(),

  // Loyalty stamp programs CRUD (Komplit tier)
  listStampPrograms: async () => await listStampPrograms(),
  getStampFormMasters: async () => await getStampFormMasters(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createStampProgram: async (data: any) =>
    await createStampProgram({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateStampProgram: async (data: any) =>
    await updateStampProgram({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteStampProgram: async (data: any) =>
    await deleteStampProgram({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStampActivity: async (data: any) => await getStampActivity({ data }),

  // Prep & waste report
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPrepWasteReport: async (data: any) =>
    await getPrepWasteReport({ data: data ?? {} }),

  // ── Inventory — Phase D mobile gap-fill ─────────────────────────
  // Tenant-wide movement ledger + per-item movement unit picker.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listInventoryMovements: async (data: any) =>
    await listInventoryMovements({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getItemMovementUnits: async (data: any) =>
    await getItemMovementUnits({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteMovement: async (data: any) => await deleteMovement({ data }),

  // Bulk import from HPP catalog
  getHppImportCandidates: async () => await getHppImportCandidates(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bulkCreateInventoryItemsFromHpp: async (data: any) =>
    await bulkCreateInventoryItemsFromHpp({ data }),

  // Branch create (inventory-scoped warehouse / outlet)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createInventoryBranch: async (data: any) =>
    await createInventoryBranch({ data }),

  // Purchase orders CRUD + status transitions
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listPurchaseOrders: async (data: any) =>
    await listPurchaseOrders({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getPurchaseOrder: async (data: any) => await getPurchaseOrder({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createPurchaseOrder: async (data: any) =>
    await createPurchaseOrder({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendPurchaseOrder: async (data: any) => await sendPurchaseOrder({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cancelPurchaseOrder: async (data: any) =>
    await cancelPurchaseOrder({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  receivePurchaseOrder: async (data: any) =>
    await receivePurchaseOrder({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listItemsForPO: async (data: any) =>
    await listItemsForPO({ data: data ?? {} }),

  // ── Attendance — Phase D mobile gap-fill ────────────────────────
  // Settings + billing read/write
  getAttendanceOverview: async () => await getAttendanceOverview(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMyBillingHistory: async (data: any) =>
    await getMyBillingHistory({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateModeToggles: async (data: any) =>
    await updateModeToggles({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateQrRotation: async (data: any) =>
    await updateQrRotation({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateAttendanceReminderSettings: async (data: any) =>
    await updateAttendanceReminderSettings({ data }),

  // Staff billing toggle + quota
  getStaffQuota: async () => await getStaffQuota(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setStaffActive: async (data: any) => await setStaffActive({ data }),

  // Shifts CRUD + scheduling + staff assign
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listShifts: async (data: any) =>
    await listShifts({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getShiftWithSchedule: async (data: any) =>
    await getShiftWithSchedule({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createShift: async (data: any) => await createShift({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateShift: async (data: any) => await updateShift({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteShift: async (data: any) => await deleteShift({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setShiftSchedule: async (data: any) =>
    await setShiftSchedule({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setStaffShift: async (data: any) => await setStaffShift({ data }),

  // QR host (live kiosk QR with rotating token)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  startQrHost: async (data: any) => await startQrHost({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rotateQrToken: async (data: any) => await rotateQrToken({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stopQrHost: async (data: any) => await stopQrHost({ data }),

  // ── Cashflow — Phase D ─────────────────────────────────────────
  getCashflowOverview: async () => await getCashflowOverview(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCashflowDashboard: async (data: any) =>
    await getCashflowDashboard({ data: data ?? {} }),
  listCashflowBranches: async () => await listCashflowBranches(),

  // Categories CRUD
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCashflowCategory: async (data: any) =>
    await createCashflowCategory({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateCashflowCategory: async (data: any) =>
    await updateCashflowCategory({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteCashflowCategory: async (data: any) =>
    await deleteCashflowCategory({ data }),

  // Entries (main ledger)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listCashflowEntries: async (data: any) =>
    await listCashflowEntries({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCashflowEntry: async (data: any) =>
    await createCashflowEntry({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateCashflowEntry: async (data: any) =>
    await updateCashflowEntry({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteCashflowEntry: async (data: any) =>
    await deleteCashflowEntry({ data }),

  // Accounts + transfers
  listCashflowAccounts: async () => await listCashflowAccounts(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCashflowAccount: async (data: any) =>
    await createCashflowAccount({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateCashflowAccount: async (data: any) =>
    await updateCashflowAccount({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteCashflowAccount: async (data: any) =>
    await deleteCashflowAccount({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listCashflowTransfers: async (data: any) =>
    await listCashflowTransfers({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createCashflowTransfer: async (data: any) =>
    await createCashflowTransfer({ data }),

  // Accounts payable (cicilan)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listPayables: async (data: any) =>
    await listPayables({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createPayable: async (data: any) => await createPayable({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markInstallmentPaid: async (data: any) =>
    await markInstallmentPaid({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  togglePayableReminders: async (data: any) =>
    await togglePayableReminders({ data }),
  listCicilanSuppliers: async () => await listCicilanSuppliers(),

  // Accounts receivable (bon)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listReceivables: async (data: any) =>
    await listReceivables({ data: data ?? {} }),
  listArCustomerOptions: async () => await listArCustomerOptions(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getReceivablePayments: async (data: any) =>
    await getReceivablePayments({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createReceivable: async (data: any) => await createReceivable({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordArPayment: async (data: any) => await recordArPayment({ data }),

  // ── WhatsApp — Phase D ─────────────────────────────────────────
  listWaInstances: async () => await listWaInstances(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getWaInstance: async (data: any) => await getWaInstance({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getWaInstanceStatus: async (data: any) =>
    await getWaInstanceStatus({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createWaInstance: async (data: any) => await createWaInstance({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteWaInstance: async (data: any) => await deleteWaInstance({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connectWaInstance: async (data: any) =>
    await connectWaInstance({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pairWaInstanceWithCode: async (data: any) =>
    await pairWaInstanceWithCode({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  disconnectWaInstance: async (data: any) =>
    await disconnectWaInstance({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendWaMessage: async (data: any) => await sendWaMessage({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendWaImage: async (data: any) => await sendWaImage({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listWaMessages: async (data: any) => await listWaMessages({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listWaContacts: async (data: any) => await listWaContacts({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markWaContactRead: async (data: any) =>
    await markWaContactRead({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateWaInstance: async (data: any) => await updateWaInstance({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getWaMediaUrl: async (data: any) => await getWaMediaUrl({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateContactHandoff: async (data: any) =>
    await updateContactHandoff({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getAiMonthlyUsage: async (data: any) =>
    await getAiMonthlyUsage({ data: data ?? {} }),
  getWaSubscription: async () => await getWaSubscription(),

  // ── Booking — Phase D ──────────────────────────────────────────
  getBookingSettings: async () => await getBookingSettings(),
  getBookingResources: async () => await getBookingResources(),
  getBookingServices: async () => await getBookingServices(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getBookings: async (data: any) => await getBookings({ data: data ?? {} }),
  listBookingBranches: async () => await listBookingBranches(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchBookingCustomers: async (data: any) =>
    await searchBookingCustomers({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createBooking: async (data: any) => await createBooking({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBookingStatus: async (data: any) =>
    await updateBookingStatus({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBooking: async (data: any) => await updateBooking({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteBooking: async (data: any) => await deleteBooking({ data }),
  getBookingSettingsState: async () => await getBookingSettingsState(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveBookingSettings: async (data: any) =>
    await saveBookingSettings({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toggleMemberBookable: async (data: any) =>
    await toggleMemberBookable({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addBookingStaff: async (data: any) => await addBookingStaff({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteBookingResource: async (data: any) =>
    await deleteBookingResource({ data }),

  // ── Site (microsite) — Phase D ─────────────────────────────────
  getMySiteSettings: async () => await getMySiteSettings(),
  publishSite: async () => await publishSite(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSiteMaintenanceMode: async (data: any) =>
    await setSiteMaintenanceMode({ data }),
  listSitePublishHistory: async () => await listSitePublishHistory(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  claimPublicSlug: async (data: any) => await claimPublicSlug({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSiteAnalyticsSummary: async (data: any) =>
    await getSiteAnalyticsSummary({ data: data ?? {} }),

  // ── Customers (master) ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listCustomers: async (data: any) =>
    await listCustomers({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCustomer: async (data: any) => await getCustomer({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteCustomer: async (data: any) => await deleteCustomer({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exportCustomers: async (data: any) =>
    await exportCustomers({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  importCustomers: async (data: any) => await importCustomers({ data }),

  // ── Branches (master) ──────────────────────────────────────────
  listMasterBranches: async () => await listMasterBranches(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getBranchWithSchedule: async (data: any) =>
    await getBranchWithSchedule({ data }),
  getBranchManagementContext: async () => await getBranchManagementContext(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createBranch: async (data: any) => await createBranch({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateBranch: async (data: any) => await updateBranch({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteBranch: async (data: any) => await deleteBranch({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setBranchSchedule: async (data: any) =>
    await setBranchSchedule({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setBranchScheduleMode: async (data: any) =>
    await setBranchScheduleMode({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getBranchBusinessHours: async (data: any) =>
    await getBranchBusinessHours({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setBranchBusinessHours: async (data: any) =>
    await setBranchBusinessHours({ data }),

  // ── Suppliers + Categories update/delete (HPP) ─────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateSupplier: async (data: any) => await updateSupplier({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteSupplier: async (data: any) => await deleteSupplier({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTenantCategory: async (data: any) =>
    await updateTenantCategory({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteTenantCategory: async (data: any) =>
    await deleteTenantCategory({ data }),

  // ── Tenant members + roles ─────────────────────────────────────
  getRolesForAssignment: async () => await getRolesForAssignment(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listTenantMembers: async (data: any) =>
    await listTenantMembers({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inviteTenantMember: async (data: any) =>
    await inviteTenantMember({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTenantMemberProfile: async (data: any) =>
    await updateTenantMemberProfile({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTenantMemberRole: async (data: any) =>
    await updateTenantMemberRole({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeTenantMember: async (data: any) =>
    await removeTenantMember({ data }),
  listTenantBranchesForMembers: async () =>
    await listTenantBranchesForMembers(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTenantMemberBranches: async (data: any) =>
    await setTenantMemberBranches({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invitePhoneOnlyTenantMember: async (data: any) =>
    await invitePhoneOnlyTenantMember({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTenantMemberWaLogin: async (data: any) =>
    await setTenantMemberWaLogin({ data }),
  getTenantSlugForWaLogin: async () => await getTenantSlugForWaLogin(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getWaLoginAvailability: async (data: any) =>
    await getWaLoginAvailability({ data: data ?? {} }),

  // Roles
  listTenantRoles: async () => await listTenantRoles(),
  listAllPermissions: async () => await listAllPermissions(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createTenantRole: async (data: any) => await createTenantRole({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateTenantRole: async (data: any) => await updateTenantRole({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteTenantRole: async (data: any) => await deleteTenantRole({ data }),

  // ── Announcements admin ────────────────────────────────────────
  listAnnouncementsAdmin: async () => await listAnnouncementsAdmin(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createAnnouncement: async (data: any) =>
    await createAnnouncement({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateAnnouncement: async (data: any) =>
    await updateAnnouncement({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteAnnouncement: async (data: any) =>
    await deleteAnnouncement({ data }),

  // ── Auth password ─────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  changePassword: async (data: any) => await changePassword({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setAuthPassword: async (data: any) => await setAuthPassword({ data }),

  // ── Referrals (tenant) ─────────────────────────────────────────
  getMyCommissionSummary: async () => await getMyCommissionSummary(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listMyCommissions: async (data: any) =>
    await listMyCommissions({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listMyClaimRequests: async (data: any) =>
    await listMyClaimRequests({ data: data ?? {} }),
  getMyPayoutMethod: async () => await getMyPayoutMethod(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  upsertPayoutMethod: async (data: any) =>
    await upsertPayoutMethod({ data }),
  submitClaimRequest: async () => await submitClaimRequest(),
  getReferralCap: async () => await getReferralCap(),
  listMyReferralCodes: async () => await listMyReferralCodes(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createReferralCode: async (data: any) =>
    await createReferralCode({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateReferralCode: async (data: any) =>
    await updateReferralCode({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toggleReferralCode: async (data: any) =>
    await toggleReferralCode({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listMyAttributions: async (data: any) =>
    await listMyAttributions({ data: data ?? {} }),

  // ── Onboarding ─────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completeOnboarding: async (data: any) =>
    await completeOnboarding({ data }),

  // ── Studio (combined konten + branding gallery) ────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listStudioGenerations: async (data: any) =>
    await listStudioGenerations({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getStudioDownloadUrl: async (data: any) =>
    await getStudioDownloadUrl({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteStudioGeneration: async (data: any) =>
    await deleteStudioGeneration({ data }),

  // ── Konten (AI image gen + ledger) ────────────────────────────
  getMyKontenLedger: async () => await getMyKontenLedger(),
  getKontenStatus: async () => await getKontenStatus(),
  getKontenPromptConfig: async () => await getKontenPromptConfig(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listKontenImages: async (data: any) =>
    await listKontenImages({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateKontenImage: async (data: any) =>
    await generateKontenImage({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getKontenImageDownloadUrl: async (data: any) =>
    await getKontenImageDownloadUrl({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteKontenImage: async (data: any) =>
    await deleteKontenImage({ data }),

  // ── Logo ──────────────────────────────────────────────────────
  getLogoStatus: async () => await getLogoStatus(),
  getLogoPromptConfig: async () => await getLogoPromptConfig(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listLogos: async (data: any) => await listLogos({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateLogo: async (data: any) => await generateLogo({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLogoDownloadUrl: async (data: any) =>
    await getLogoDownloadUrl({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteLogo: async (data: any) => await deleteLogo({ data }),

  // ── Spanduk ───────────────────────────────────────────────────
  getSpandukStatus: async () => await getSpandukStatus(),
  getSpandukConfig: async () => await getSpandukConfig(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listSpanduks: async (data: any) =>
    await listSpanduks({ data: data ?? {} }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  generateSpanduk: async (data: any) => await generateSpanduk({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  commitSpandukPreview: async (data: any) =>
    await commitSpandukPreview({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getSpandukDownloadUrl: async (data: any) =>
    await getSpandukDownloadUrl({ data }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteSpanduk: async (data: any) => await deleteSpanduk({ data }),
}

export const Route = createFileRoute('/api/mobile/$fn')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const fn = params.fn
        const handler = HANDLERS[fn]
        if (!handler) {
          return json({ error: `Unknown function: ${fn}` }, { status: 404 })
        }

        let body: { data?: unknown } = {}
        try {
          const text = await request.text()
          body = text ? (JSON.parse(text) as { data?: unknown }) : {}
        } catch {
          return json({ error: 'Invalid JSON body' }, { status: 400 })
        }

        try {
          const result = await handler(body.data)
          return json(result ?? null)
        } catch (err) {
          // The server fn's error string is usually Indonesian and
          // safe to surface — they're tenant-facing copy.
          const message =
            err instanceof Error ? err.message : 'Server error'
          const status = inferStatus(message)
          return json({ error: message }, { status })
        }
      },
    },
  },
})

function json(body: unknown, init?: { status?: number }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

function inferStatus(message: string): number {
  const m = message.toLowerCase()
  if (m.includes('unauthorized')) return 401
  if (m.includes('notenant') || m.includes('not found')) return 404
  if (m.includes('forbidden') || m.includes('tidak diizinkan')) return 403
  if (m.includes('belum') || m.includes('wajib') || m.includes('tidak valid'))
    return 400
  return 500
}
