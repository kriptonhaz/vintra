# Plan: Internal Marketing Commission System

> Status: ALL PHASES (1–5) DONE. Verified end-to-end (17/17 checks).
> Default marketing cap = 10% (referral_global_config.marketing_cap_pct).
> Demo data live on dev: head head.marketing@vintra.my.id + staff
> staff.marketing@vintra.my.id (pw MarketingDemo123!), codes HEADBOSS / STAFFSELL.
> Two latent bugs in the (pre-existing) attribution writer were fixed along the
> way — see Phase 5 notes.
> Mantra Maker (2b0fae13-…) is flagged is_internal=true. No agents enrolled yet —
> the Marketing nav stays hidden until an admin enrolls a head (Phase 4 UI, or a
> manual enroll on request).
> This is an internal/team commission system layered on top of the existing
> tenant-to-tenant referral system. Vintra's own marketing people (members of
> the internal "mantra maker" tenant) earn commission when tenants they refer
> pay for paid modules.

## 1. Concept & terminology

- **Internal tenant** — the existing "mantra maker" tenant, flagged as Vintra's
  internal org. Its members are the people who can be marketing agents.
  (Flag: `is_internal boolean` on `tenants`.)
- **Marketing agent** — a member of the internal tenant enrolled in the program.
  Two roles: `head` and `staff`. A staff has exactly one head (`parent_agent_id`).
  Multiple heads are supported, each with their own staff group.
- **Agent code** — a referral code owned by an agent (by `userId`), not by a
  tenant. Heads can also own a code and refer directly.
- Runs **alongside** the existing tenant-to-tenant referral. A registering tenant
  uses **one** code (tenant's or agent's); exactly **one attribution** per tenant
  (existing unique constraint stays).

## 2. Confirmed decisions

| Decision | Choice |
|---|---|
| Commission trigger | Every paid payment, recurring within the attribution window (same as today) |
| Staff commission | Percentage of payment amount |
| Head earnings | Separate override % on staff's sales, funded by Vintra, bounded by the cap |
| Identity | Members of the internal "mantra maker" tenant; marketing structure scoped per-userId |
| Hierarchy | Multiple heads, each with own staff (2 levels: head -> staff) |
| Who sets % | Admin sets global + per-head cap; head allocates (override + per-staff budget); staff splits their budget |
| Coexistence | One code field, one attribution per tenant; both systems run side by side |
| Tenant discount | Reuse existing discount mechanism |
| Withdrawals | Reuse existing claim-request/payout machinery, scoped per agent |

## 3. The cap-allocation tree

```
Global cap (set by platform admin)              e.g. 20%
  └─ per HEAD: cap assigned by admin (≤ global) e.g. 20%
       └─ per STAFF (head decides the split):
            ├─ head override %  e.g. 5%   ← head earns this on that staff's sales
            └─ staff budget %   e.g. 15%  ← what the staff has to work with
                 └─ staff splits their budget (staff decides):
                      ├─ tenant discount %  e.g. 10%
                      └─ staff commission % e.g. 5%

Invariant per payment:  discount + staffCommission + headOverride  ≤  cap
Vintra funds all three slices separately (head's cut is NOT deducted from staff).
```

On each paid payment by a referred tenant: tenant gets the discount, the staff
earns their commission slice, **and** the head earns their override slice — two
separate ledger entries, both funded by Vintra within the cap.

**Resolved interpretation:** admin sets each head's ceiling (cap); the head
allocates within it (their own override % + each staff's budget).

## 4. Data model changes

**Strategy: extend the existing referral pipeline rather than fork it.**
Attribution, discount application, recurring credit, clawback, refund reversal,
and the public code-validation flow are nearly identical. Add an
"owner/beneficiary" abstraction so tenant-referrals and agent-referrals share the
same plumbing.

**New tables** (`packages/db/src/schema/marketing.ts`):

- `marketing_agents` — `id`, `tenantId` (internal tenant), `userId`, `role`
  (`head`|`staff`), `parentAgentId` (nullable self-ref), `capPct` (head only,
  set by admin), `staffBudgetPct` + `headOverridePct` (staff only, set by their
  head), `isActive`, timestamps. Unique on `userId`.

**Extensions to existing referral tables:**

- `referral_codes` — add `ownerType` (`tenant`|`agent`, default `tenant`),
  `ownerAgentId` (nullable). For agent codes, `tenantId` = internal tenant.
- `referral_attributions` — add `ownerType`, `staffAgentId`, `headAgentId`
  (nullable), `headOverridePctSnapshot`. Keep one-per-referee unique constraint.
- `referral_commissions` — add `beneficiaryType` (`tenant`|`agent`),
  `beneficiaryAgentId` (nullable). Agent referrals create **two** rows per
  payment (staff + head); tenant referrals create one as today.
- `referral_claim_requests` — add `ownerType`, `ownerAgentId` (nullable).
- `tenant_payout_methods` — add `ownerType`, `ownerAgentId` to support
  agent-owned payout methods (keep one withdrawal pipeline).

Migration via generate-then-migrate workflow (never `drizzle-kit push`), mindful
of the journal `when`-timestamp gotcha for any hand-edits.

## 5. Percentage / cap rules (validation)

- Admin: `globalCapPct` (extend `referral_global_config`), `marketing_agents.capPct`
  per head (≤ global).
- Head allocation per staff: `headOverridePct + staffBudgetPct ≤ head.capPct`.
- Staff code: `discountPct + commissionPct ≤ staffBudgetPct`.
- Head's own code: `discountPct + commissionPct ≤ head.capPct`.
- Enforced client-side (Zod) and server-side, reusing the existing cap-validation
  pattern in `referrals.ts`.

## 6. Server-side logic

- **Attribution** (`referral-attribute.ts`): agent code -> snapshot
  `staffCommissionPct`, `headOverridePct`, `discountPct`, `staffAgentId`,
  `headAgentId`.
- **Discount** (`referral-discount.ts`): unchanged.
- **Credit** (`referral-credit.ts`): branch on `ownerType`. Agent -> staff row +
  head override row. Tenant -> one row as today.
- **Reversal** (refund): reverse all commission rows for the invoice.
- **New server-function files:**
  - `marketing-agents.ts` — head manages staff, team rollup.
  - `marketing-commission.ts` — agent commission summary, history, referral count,
    claim submission + history, payout method.
  - `marketing-codes.ts` — agent CRUD for own codes within budget.
  - `admin-marketing.ts` — admin global cap, enroll heads + caps, program stats.
    Agent withdrawals flow through the existing admin claims queue.

## 7. UI / routes

**Agent area** (`_authed/marketing/`, gated by "is current user a marketing agent"):
- `marketing/codes` — my referral codes (create/edit within budget).
- `marketing/referrals` — tenants I referred + payment history + count.
- `marketing/commission` — summary, history, payout method, claim + history.
- `marketing/team` — **head only**: list staff, set override % + budget %, rollup.

**Admin area** — extend `/admin/referrals/*`:
- `admin/marketing` — global cap, enroll heads, set head caps, program stats.
- Existing `/admin/referrals/claims` extended to include agent claims.

Indonesian UI, Rupiah formatting, Sheet sticky-footer forms, skeleton loaders.

## 8. Registration & attribution flow

No UX change. `validateReferralCode` works for agent codes (shows discount + a
generic "Vintra partner" label, hides commission). `attributeReferralIfPresent`
detects agent ownership and snapshots agent fields. Self-referral / quota /
inactive guards unchanged.

## 9. Access control

- Marketing area visible only to internal-tenant members enrolled as agents;
  `marketing/team` only to `role=head`.
- Reuse platform-admin guard for admin marketing pages.
- New middleware `requireMarketingAgent()` analogous to `requireReferralAccess()`.

## 10. Build phases

1. **Schema + migration** — new tables, extend existing, migrate. Add
   internal-tenant flag. *(DONE — migrations 0138, 0139)*
2. **Cap/allocation engine + server functions** — admin config & head enrollment,
   head allocations, staff codes, dual-row credit logic, Zod cap validation.
   *(DONE)*
   - `middleware/marketing-agent.ts` — `requireMarketingAgent()` / `requireMarketingHead()`
   - `functions/admin-marketing.ts` — config, internal-tenant designation, head
     enrollment + caps, agent roster
   - `functions/marketing-team.ts` — head staff management + team rollup
   - `functions/marketing-codes.ts` — agent code CRUD with budget validation
   - `functions/marketing-commission.ts` — commission summary/history/referrals,
     payout method, claim submit/history (scoped by beneficiary_agent_id)
   - `lib/referral-attribute.ts` — snapshots agent fields on agent-code signup
   - `lib/referral-credit.ts` — dual-row credit (staff commission + head override)
   - `functions/referrals-public.ts` — agent codes show "Mitra Vintra" label
3. **Agent dashboard UI** — codes, referrals, commission, withdrawal. *(DONE)*
   - `routes/_authed/marketing.tsx` — layout, agent guard, budget info, tabs
   - `marketing.index.tsx` — code CRUD + share dialog (budget-capped)
   - `marketing.referrals.tsx` — tenants the agent referred + commission
   - `marketing.commission.tsx` — stats, history (Langsung/Override), claim, bank
   - `getCurrentUser` now returns `marketingAgent` + `marketingRole`; sidebar shows
     a Marketing entry gated on `feature: 'marketing'`
4. **Head team-management UI** + admin marketing UI + extended claims queue. *(DONE)*
   - `routes/_authed/marketing.team.tsx` — head-only staff roster, add/edit staff
     allocation (override% + budget% ≤ head cap), toggle active, team rollup tiles;
     "Tim" tab added to the marketing layout for heads
   - `routes/admin/marketing.tsx` — global cap config, internal-tenant designation
     (search + toggle), head enrollment, agent roster (toggle active, edit head cap)
   - `referral-admin.ts` — claims queue resolves agent claimant names + notifies the
     agent (not the internal tenant owner); `referrals.claims.tsx` shows a
     Tenant/Kepala/Marketing badge. Agent claims share the existing claims queue.
   - Admin nav: `admin.navMarketing` → `/admin/marketing` (id + en locales)
5. **Wire attribution + credit into payment path**, verify recurring credit,
   clawback, refund reversal, discount for agent codes. End-to-end test. *(DONE)*
   - Verified through the real pipeline functions (attributeReferralIfPresent →
     applyReferralDiscount → creditReferralCommissionIfApplicable →
     reverseReferralCommissionsForInvoice): 17/17 assertions passed. Example:
     staff code 5% disc + 3% comm, head override 2% → Rp100k payment becomes
     Rp95k, staff earns Rp2,850, head earns Rp1,900; clawback rollover and
     refund reversal both correct.
   - **Latent bugs fixed in `referral-attribute.ts`** (affected the pre-existing
     tenant referral path too, silently swallowed by its best-effort try/catch):
     1. `maxClaims` param in `... IS NULL` had no inferable type under the
        Supabase pooler → `42P18`. Fixed with `::int` casts.
     2. Raw `Date` objects can't be bound in a parameterized `sql` template under
        `prepare:false` → "Received an instance of Date". Fixed by binding ISO
        strings with `::timestamptz`.
   - `packages/db` now exports `./schema` explicitly (lets node/tsx/bun resolve
     the subpath; Vite already resolved it via tsconfig paths).

## 11. Open items / edge cases

- What happens to a staff's open commissions when a head re-allocates their budget
  or removes them? Proposal: attribution snapshots are immutable; only future
  payments use new rates.
- A head moving a staff to a different head — not supported in v1.
