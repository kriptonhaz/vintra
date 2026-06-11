// JUR-91: server-only attribution writer. Lives outside the server
// functions directory so the client bundle doesn't pull in the
// drizzle/postgres dependency chain — only the server-side `auth.ts`
// imports this file, and the chunker keeps it on the server.
//
// Best-effort: invalid / inactive / self-referral all silently no-op
// so a bad code never blocks signup. The unique constraint on
// referee_tenant_id makes the insert idempotent.

import { db } from '@vintra/db'
import {
  referralCodes,
  referralAttributions,
  referralGlobalConfig,
} from '@vintra/db/schema'
import { and, eq, sql } from 'drizzle-orm'

export async function attributeReferralIfPresent({
  newTenantId,
  rawCode,
}: {
  newTenantId: string
  rawCode: string | null | undefined
}): Promise<void> {
  const code = rawCode?.trim().toUpperCase()
  if (!code) return

  try {
    const [row] = await db
      .select()
      .from(referralCodes)
      .where(and(eq(referralCodes.code, code), eq(referralCodes.isActive, true)))
      .limit(1)
    if (!row) return
    // Self-referral: refuse silently. Don't leak that the code was
    // theirs — just skip the attribution.
    if (row.tenantId === newTenantId) return

    const [cfg] = await db.select().from(referralGlobalConfig).limit(1)
    const windowMonths = cfg?.defaultWindowMonths ?? 12
    const now = new Date()
    const windowEndsAt = new Date(now)
    windowEndsAt.setMonth(windowEndsAt.getMonth() + windowMonths)

    // INSERT ... WHERE NOT EXISTS gates the attribution on the current
    // claim count atomically. Two concurrent signups racing on the same
    // code can still slip one extra past the cap in theory (the count
    // is read in the same statement but not under lock), but the window
    // is microseconds and a cap of 1000 stays cosmetically correct.
    // The unique constraint on referee_tenant_id still prevents any
    // single tenant being double-attributed.
    await db.execute(sql`
      INSERT INTO ${referralAttributions} (
        referee_tenant_id, code_id, referrer_tenant_id,
        discount_pct_snapshot, commission_pct_snapshot,
        window_months, attributed_at, window_ends_at
      )
      SELECT
        ${newTenantId}::uuid, ${row.id}::uuid, ${row.tenantId}::uuid,
        ${row.discountPct}::numeric, ${row.commissionPct}::numeric,
        ${windowMonths}, ${now}::timestamptz, ${windowEndsAt}::timestamptz
      WHERE ${row.maxClaims} IS NULL
         OR (
           SELECT COUNT(*) FROM ${referralAttributions}
           WHERE code_id = ${row.id}::uuid
         ) < ${row.maxClaims}
      ON CONFLICT (referee_tenant_id) DO NOTHING
    `)
  } catch (err) {
    // Don't fail the signup over an attribution glitch — log and move on.
    console.error('[referral] attribute failed', err)
  }
}
