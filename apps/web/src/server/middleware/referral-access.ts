import { db } from '@vintra/db'
import { tenantReferralSettings } from '@vintra/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, type AuthContext } from './auth'

/**
 * Referral access resolver. The referral program is curated: only
 * tenants with an enabled `tenant_referral_settings` row can RUN a
 * program — create codes, view pendaftar, claim commissions.
 *
 * Being *referred* (signing up with someone else's code, getting the
 * discount) is NOT gated here — that path is universal and never
 * calls this middleware.
 *
 * `referralCapPct` is the per-tenant cap that replaces the global
 * `referral_global_config.capPct` for this tenant; create/update of
 * codes enforce `discountPct + commissionPct <= referralCapPct`.
 */
export interface ReferralAccessContext extends AuthContext {
  referralCapPct: number
}

export async function requireReferralAccess(): Promise<ReferralAccessContext> {
  const auth = await requireAuth()

  const [row] = await db
    .select({
      enabled: tenantReferralSettings.enabled,
      capPct: tenantReferralSettings.capPct,
    })
    .from(tenantReferralSettings)
    .where(eq(tenantReferralSettings.tenantId, auth.tenantId))
    .limit(1)

  if (!row || !row.enabled) {
    throw new Error(
      'Fitur referral tidak aktif untuk akun ini. Hubungi admin untuk mengaktifkan.',
    )
  }

  return { ...auth, referralCapPct: Number(row.capPct) }
}
