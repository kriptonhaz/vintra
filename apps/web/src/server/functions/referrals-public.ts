import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { db } from '@vintra/db'
import { referralAttributions, referralCodes, tenants } from '@vintra/db/schema'
import { eq, sql } from 'drizzle-orm'

// JUR-91: public referral-code lookup. No auth required — the register
// form calls this on blur to confirm a code is real before letting the
// user submit. Returns minimal info: just the discount % and the
// referrer's display name. Commission % is hidden (that's between the
// referrer and us, not the new signup).
//
// Note: the attribution writer (attributeReferralIfPresent) used to
// live in this file but was moved to server/lib/referral-attribute.ts
// because the client-side register form imports validateReferralCode
// from here, and a plain async function couldn't be tree-shaken out of
// the client bundle (unlike createServerFn handlers, which compile to
// thin RPC stubs on the client). Without that split, Vite tried to
// bundle the `postgres` driver for the browser and the build failed.
export const validateReferralCode = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ code: z.string().min(1).max(40) }))
  .handler(async ({ data }) => {
    const normalized = data.code.trim().toUpperCase()
    if (!normalized) return { valid: false as const }

    const [row] = await db
      .select({
        id: referralCodes.id,
        code: referralCodes.code,
        discountPct: referralCodes.discountPct,
        isActive: referralCodes.isActive,
        maxClaims: referralCodes.maxClaims,
        referrerName: tenants.businessName,
        // Aggregated alongside the lookup so we only do a single round
        // trip. NULL if no attributions exist yet — count() returns 0.
        usedCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM ${referralAttributions}
          WHERE ${referralAttributions.codeId} = ${referralCodes.id}
        )`,
      })
      .from(referralCodes)
      .leftJoin(tenants, eq(tenants.id, referralCodes.tenantId))
      .where(eq(referralCodes.code, normalized))
      .limit(1)

    if (!row || !row.isActive) {
      return { valid: false as const }
    }

    // Code exists and is active, but the per-code quota is exhausted.
    // Surfaced as a distinct state so the register form can show a
    // specific message ("kode sudah penuh") instead of the generic
    // "tidak ditemukan" — same effect on signup (no discount, no
    // attribution) but better UX.
    if (row.maxClaims !== null && row.usedCount >= row.maxClaims) {
      return { valid: false as const, reason: 'quota_full' as const }
    }

    return {
      valid: true as const,
      code: row.code,
      discountPct: row.discountPct,
      referrerName: row.referrerName ?? '',
    }
  })
