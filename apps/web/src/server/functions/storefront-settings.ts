/**
 * Toko Online — admin config server functions (Phase 1).
 *
 * Gated by `requireTenantSiteAccess` (Komplit + `tenant_site`) plus the
 * `pos.manage` permission — storefront config is a commerce-owner
 * concern that lives inside the Situs surface.
 *
 * Payment methods stay sourced from `pos_settings.default_payment_methods`;
 * the storefront only persists the SUBSET to display, validated against
 * that list on save.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  storefrontSettings,
  storefrontShippingZones,
  posSettings,
  branches,
  waInstances,
} from '@vintra/db/schema'
import { eq, and, asc } from 'drizzle-orm'
import {
  requireTenantSiteAccess,
  type POSAccessContext,
} from '../middleware/module-access'

const PAYMENT_METHODS = [
  'cash',
  'qris',
  'transfer',
  'card',
  'ewallet',
  'gopay',
  'shopeepay',
  'ovo',
] as const

function assertManage(auth: POSAccessContext) {
  if (!auth.permissions.includes('pos.manage')) {
    throw new Error('Forbidden')
  }
}

/** Normalise an Indonesian phone to "62…" digits, or null if blank. */
function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  let digits = input.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('0')) digits = '62' + digits.slice(1)
  else if (digits.startsWith('8')) digits = '62' + digits
  return digits
}

// ─── Read ────────────────────────────────────────────────────────────

export const getStorefrontSettings = createServerFn().handler(async () => {
  const auth = await requireTenantSiteAccess()
  assertManage(auth)

  const [settings] = await db
    .select()
    .from(storefrontSettings)
    .where(eq(storefrontSettings.tenantId, auth.tenantId))
    .limit(1)

  const [pos] = await db
    .select({
      defaultPaymentMethods: posSettings.defaultPaymentMethods,
      bankAccounts: posSettings.bankAccounts,
    })
    .from(posSettings)
    .where(eq(posSettings.tenantId, auth.tenantId))
    .limit(1)

  const zones = await db
    .select()
    .from(storefrontShippingZones)
    .where(eq(storefrontShippingZones.tenantId, auth.tenantId))
    .orderBy(asc(storefrontShippingZones.sortOrder))

  const branchList = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(and(eq(branches.tenantId, auth.tenantId), eq(branches.isActive, true)))
    .orderBy(asc(branches.createdAt))

  const waList = await db
    .select({
      id: waInstances.id,
      label: waInstances.label,
      status: waInstances.status,
      adminPhone: waInstances.adminPhone,
    })
    .from(waInstances)
    .where(eq(waInstances.tenantId, auth.tenantId))

  return {
    settings: settings ?? null,
    // Source of truth — which methods the tenant enabled in POS.
    posPaymentMethods: (pos?.defaultPaymentMethods ?? []) as string[],
    hasBankAccounts: (pos?.bankAccounts ?? []).length > 0,
    zones,
    branches: branchList,
    waInstances: waList,
  }
})

// ─── Write: settings ───────────────────────────────────────────────

const updateInput = z.object({
  isEnabled: z.boolean().optional(),
  fulfillmentBranchId: z.string().uuid().nullable().optional(),
  paymentMethods: z.array(z.enum(PAYMENT_METHODS)).optional(),
  deliveryEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  flatShippingFee: z.coerce.number().min(0).optional(),
  waConfirmPhone: z.string().max(25).nullable().optional(),
  adminNotifyInstanceId: z.string().uuid().nullable().optional(),
  applyTax: z.boolean().optional(),
  checkoutNote: z.string().max(1000).nullable().optional(),
})

export const updateStorefrontSettings = createServerFn({ method: 'POST' })
  .inputValidator(updateInput)
  .handler(async ({ data }) => {
    const auth = await requireTenantSiteAccess()
    assertManage(auth)

    // Payment subset must be within what POS has enabled.
    if (data.paymentMethods) {
      const [pos] = await db
        .select({ defaultPaymentMethods: posSettings.defaultPaymentMethods })
        .from(posSettings)
        .where(eq(posSettings.tenantId, auth.tenantId))
        .limit(1)
      const allowed = new Set(pos?.defaultPaymentMethods ?? [])
      for (const m of data.paymentMethods) {
        if (!allowed.has(m)) {
          throw new Error(
            `Metode pembayaran "${m}" belum diaktifkan di Pengaturan Kasir.`,
          )
        }
      }
    }

    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (data.isEnabled !== undefined) set.isEnabled = data.isEnabled
    if (data.fulfillmentBranchId !== undefined)
      set.fulfillmentBranchId = data.fulfillmentBranchId
    if (data.paymentMethods !== undefined) set.paymentMethods = data.paymentMethods
    if (data.deliveryEnabled !== undefined)
      set.deliveryEnabled = data.deliveryEnabled
    if (data.pickupEnabled !== undefined) set.pickupEnabled = data.pickupEnabled
    if (data.flatShippingFee !== undefined)
      set.flatShippingFee = data.flatShippingFee.toString()
    if (data.waConfirmPhone !== undefined)
      set.waConfirmPhone = normalizePhone(data.waConfirmPhone)
    if (data.adminNotifyInstanceId !== undefined)
      set.adminNotifyInstanceId = data.adminNotifyInstanceId
    if (data.applyTax !== undefined) set.applyTax = data.applyTax
    if (data.checkoutNote !== undefined)
      set.checkoutNote = data.checkoutNote?.trim() ? data.checkoutNote : null

    await db
      .insert(storefrontSettings)
      .values({ tenantId: auth.tenantId, ...(set as any) })
      .onConflictDoUpdate({ target: storefrontSettings.tenantId, set })

    return { success: true as const }
  })

// ─── Write: shipping zones (replace-all) ───────────────────────────

const zonesInput = z.object({
  zones: z
    .array(
      z.object({
        name: z.string().min(1, 'Nama zona wajib diisi').max(40),
        fee: z.coerce.number().min(0),
        isActive: z.boolean(),
      }),
    )
    .max(20),
})

export const saveShippingZones = createServerFn({ method: 'POST' })
  .inputValidator(zonesInput)
  .handler(async ({ data }) => {
    const auth = await requireTenantSiteAccess()
    assertManage(auth)

    // Replace-all. Existing orders snapshot `shipping_zone_label` and the
    // FK is ON DELETE SET NULL, so dropping/replacing rows is safe.
    await db.transaction(async (tx) => {
      await tx
        .delete(storefrontShippingZones)
        .where(eq(storefrontShippingZones.tenantId, auth.tenantId))
      if (data.zones.length > 0) {
        await tx.insert(storefrontShippingZones).values(
          data.zones.map((z, i) => ({
            tenantId: auth.tenantId,
            name: z.name,
            fee: z.fee.toString(),
            sortOrder: i,
            isActive: z.isActive,
          })),
        )
      }
    })

    return { success: true as const }
  })
