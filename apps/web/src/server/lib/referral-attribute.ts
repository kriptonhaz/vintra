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
  marketingAgents,
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
    // Bind as ISO strings (not Date objects): under Supabase's transaction
    // pooler (`prepare: false`) the postgres driver fails to serialize a raw
    // Date in a parameterized `sql` template ("Received an instance of Date").
    // The `::timestamptz` casts below accept the ISO text.
    const nowIso = now.toISOString()
    const windowEndsIso = windowEndsAt.toISOString()

    // For agent (internal marketing) codes, resolve the owning agent so we
    // can snapshot WHO earns what at signup time:
    //   - staff code → staff is the referrer; their head earns an override
    //   - head's own code → head is the referrer; no override layer
    // Snapshotting means a later re-allocation never rewrites past earnings.
    const isAgentCode = row.ownerType === 'agent' && !!row.ownerAgentId
    let ownerType: 'tenant' | 'agent' = 'tenant'
    let staffAgentId: string | null = null
    let headAgentId: string | null = null
    let headOverridePctSnapshot: string | null = null

    if (isAgentCode) {
      const [ag] = await db
        .select()
        .from(marketingAgents)
        .where(eq(marketingAgents.id, row.ownerAgentId!))
        .limit(1)
      if (ag) {
        ownerType = 'agent'
        staffAgentId = ag.id
        if (ag.role === 'staff' && ag.parentAgentId) {
          headAgentId = ag.parentAgentId
          headOverridePctSnapshot = ag.headOverridePct
        }
      }
    }

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
        owner_type, staff_agent_id, head_agent_id, head_override_pct_snapshot,
        discount_pct_snapshot, commission_pct_snapshot,
        window_months, attributed_at, window_ends_at
      )
      SELECT
        ${newTenantId}::uuid, ${row.id}::uuid, ${row.tenantId}::uuid,
        ${ownerType}::text,
        ${staffAgentId}::uuid, ${headAgentId}::uuid,
        ${headOverridePctSnapshot}::numeric,
        ${row.discountPct}::numeric, ${row.commissionPct}::numeric,
        ${windowMonths}, ${nowIso}::timestamptz, ${windowEndsIso}::timestamptz
      WHERE ${row.maxClaims}::int IS NULL
         OR (
           SELECT COUNT(*) FROM ${referralAttributions}
           WHERE code_id = ${row.id}::uuid
         ) < ${row.maxClaims}::int
      ON CONFLICT (referee_tenant_id) DO NOTHING
    `)
  } catch (err) {
    // Don't fail the signup over an attribution glitch — log and move on.
    console.error('[referral] attribute failed', err)
  }
}
