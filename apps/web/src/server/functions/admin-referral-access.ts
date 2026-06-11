import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import {
  tenantReferralSettings,
  referralCodes,
  referralGlobalConfig,
  platformAdminAuditLogs,
} from '@vintra/db/schema'
import { eq, sql } from 'drizzle-orm'
import { requirePlatformAdmin } from '@/server/middleware/platform-admin'

// Admin control surface for the referral allowlist (JUR — referral
// redesign). The referral program is curated: a tenant can RUN a
// program only when it has an enabled `tenant_referral_settings` row.
// These fns power the card on /admin/tenants/:id and the read-only
// audit list at /admin/referrals/access.

const PCT_REGEX = /^\d+(\.\d{1,2})?$/

/**
 * Settings row + the global default cap (used to prefill the cap
 * input when an admin first enables a tenant). Returns `settings:
 * null` for a tenant that's never been configured.
 */
export const getTenantReferralAccess = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ tenantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const [settings] = await db
      .select()
      .from(tenantReferralSettings)
      .where(eq(tenantReferralSettings.tenantId, data.tenantId))
      .limit(1)

    const [globalConfig] = await db
      .select({ capPct: referralGlobalConfig.capPct })
      .from(referralGlobalConfig)
      .limit(1)

    // Active code count — shown on the card so the admin sees what a
    // toggle-off would freeze.
    const [codeAgg] = await db
      .select({
        activeCount: sql<number>`count(*) filter (where ${referralCodes.isActive})::int`,
        totalCount: sql<number>`count(*)::int`,
      })
      .from(referralCodes)
      .where(eq(referralCodes.tenantId, data.tenantId))

    return {
      settings: settings ?? null,
      globalCapPct: globalConfig ? Number(globalConfig.capPct) : 20,
      activeCodeCount: codeAgg?.activeCount ?? 0,
      totalCodeCount: codeAgg?.totalCount ?? 0,
    }
  })

/**
 * Upsert a tenant's referral access. When access flips from enabled
 * to disabled, every one of that tenant's codes is frozen
 * (`is_active = false`) so no new signups can attribute to them.
 * Existing attributions + commissions are deliberately untouched —
 * referees keep their discount, the referrer keeps earning through
 * the attribution window (the "grandfather" rule).
 */
const setSchema = z.object({
  tenantId: z.string().uuid(),
  enabled: z.boolean(),
  capPct: z
    .string()
    .regex(PCT_REGEX, 'Persentase tidak valid (maks 2 desimal)')
    .refine((v) => Number(v) > 0 && Number(v) <= 100, 'Cap harus antara 0 dan 100'),
})

export const setTenantReferralAccess = createServerFn({ method: 'POST' })
  .inputValidator(setSchema)
  .handler(async ({ data }) => {
    const auth = await requirePlatformAdmin()

    const [before] = await db
      .select()
      .from(tenantReferralSettings)
      .where(eq(tenantReferralSettings.tenantId, data.tenantId))
      .limit(1)

    const wasEnabled = before?.enabled === true
    const nowDisabled = !data.enabled

    await db.transaction(async (tx) => {
      // Upsert the settings row.
      if (before) {
        await tx
          .update(tenantReferralSettings)
          .set({
            enabled: data.enabled,
            capPct: data.capPct,
            updatedAt: new Date(),
          })
          .where(eq(tenantReferralSettings.tenantId, data.tenantId))
      } else {
        await tx.insert(tenantReferralSettings).values({
          tenantId: data.tenantId,
          enabled: data.enabled,
          capPct: data.capPct,
        })
      }

      // Freeze codes only on a genuine enabled → disabled transition.
      if (wasEnabled && nowDisabled) {
        await tx
          .update(referralCodes)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(referralCodes.tenantId, data.tenantId))
      }

      await tx.insert(platformAdminAuditLogs).values({
        adminUserId: auth.userId,
        action: 'referral_access_update',
        targetTenantId: data.tenantId,
        targetUserId: null,
        metadata: {
          before: before ?? null,
          after: { enabled: data.enabled, capPct: data.capPct },
          codesFrozen: wasEnabled && nowDisabled,
        },
      })
    })

    return { ok: true, codesFrozen: wasEnabled && nowDisabled }
  })

/**
 * Read-only audit list for /admin/referrals/access — every tenant
 * with its referral access status, cap, and active code count.
 * Paginated + searchable by business name; filterable by status.
 */
const listSchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['enabled', 'disabled', 'unset']).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
})

export const listTenantReferralAccess = createServerFn({ method: 'POST' })
  .inputValidator(listSchema)
  .handler(async ({ data }) => {
    await requirePlatformAdmin()

    const offset = (data.page - 1) * data.pageSize
    const searchPattern = data.search?.trim()
      ? `%${data.search.trim()}%`
      : null
    const statusFilter = data.status ?? null

    const rows = await db.execute<{
      tenant_id: string
      business_name: string | null
      enabled: boolean | null
      cap_pct: string | null
      active_code_count: number
      total_count: number
    }>(sql`
      SELECT
        t.id AS tenant_id,
        t.business_name,
        trs.enabled,
        trs.cap_pct,
        COALESCE(code_agg.active_code_count, 0) AS active_code_count,
        COUNT(*) OVER () AS total_count
      FROM tenants t
      LEFT JOIN tenant_referral_settings trs ON trs.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE is_active) AS active_code_count
        FROM referral_codes
        WHERE tenant_id = t.id
      ) code_agg ON true
      WHERE (${searchPattern}::text IS NULL OR t.business_name ILIKE ${searchPattern}::text)
        AND (
          ${statusFilter}::text IS NULL
          OR (${statusFilter}::text = 'enabled'  AND trs.enabled IS TRUE)
          OR (${statusFilter}::text = 'disabled' AND trs.enabled IS FALSE)
          OR (${statusFilter}::text = 'unset'    AND trs.tenant_id IS NULL)
        )
      ORDER BY
        (trs.enabled IS TRUE) DESC,
        (trs.tenant_id IS NOT NULL) DESC,
        t.business_name ASC
      LIMIT ${data.pageSize}
      OFFSET ${offset}
    `)

    const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0

    return {
      total,
      page: data.page,
      pageSize: data.pageSize,
      items: rows.map((r) => ({
        tenantId: r.tenant_id,
        businessName: r.business_name ?? 'Tenant',
        // 'unset' = no row; 'enabled' / 'disabled' = row exists.
        status:
          r.enabled === null
            ? ('unset' as const)
            : r.enabled
              ? ('enabled' as const)
              : ('disabled' as const),
        capPct: r.cap_pct != null ? Number(r.cap_pct) : null,
        activeCodeCount: Number(r.active_code_count),
      })),
    }
  })
