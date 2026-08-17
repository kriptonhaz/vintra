/**
 * Supabase free-tier usage watch.
 *
 * Answers the question "are we getting close to needing to self-host?" without
 * anyone having to remember to open the Supabase dashboard.
 *
 * Data sources:
 *   - Supabase Metrics API (`/customer/v1/privileged/metrics`, Prometheus text
 *     format, HTTP basic auth as service_role + the secret key). This is the
 *     ONLY programmatic source of egress — the Management API has no usage or
 *     egress endpoint, it is dashboard-only.
 *   - The database itself, for tenant/branch counts and snapshot history.
 *
 * Egress needs special handling: `db_transmit_bytes` is a COUNTER that resets
 * when the instance restarts, so a single reading is meaningless. We store
 * snapshots in `ops_usage_snapshots` and report the rate between the two most
 * recent, projected to 30 days. A counter that went backwards means a restart,
 * and that interval is skipped rather than reported as negative egress.
 *
 * Usage:
 *   bun run check:usage           # report + record a snapshot
 *   bun run check:usage --dry     # report only, write nothing
 *
 * Exits 1 if any metric is at or above WARN_AT of its limit, so CI can fail
 * loudly. Exits 0 otherwise.
 */
import postgres from 'postgres'

// Supabase Free tier, as of 2026-08. Update if the plan changes.
const LIMITS = {
  dbBytes: 500 * 1024 * 1024, // 500 MB
  egressBytesPerMonth: 5 * 1024 * 1024 * 1024, // 5 GB
  authUsers: 50_000, // MAU
}
const WARN_AT = 0.7 // surface at 70% of a limit, per the agreed triggers

const DRY = process.argv.includes('--dry')

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`✗ ${name} is not set`)
    process.exit(2)
  }
  return v
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return 'n/a'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = Math.abs(n)
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${(n < 0 ? -v : v).toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

/** Pull one Prometheus sample. `match` narrows by label when a metric repeats. */
function metric(text: string, name: string, match?: string): number | null {
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue
    if (line.startsWith('#')) continue
    // Guard against prefix collisions (db_transmit_bytes vs db_transmit_bytes_total)
    const after = line.slice(name.length)
    if (!after.startsWith('{') && !after.startsWith(' ')) continue
    if (match && !line.includes(match)) continue
    const value = Number(line.trim().split(/\s+/).pop())
    if (Number.isFinite(value)) return value
  }
  return null
}

const projectRef = (() => {
  const url = process.env['SUPABASE_URL'] ?? ''
  const m = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)
  if (!m) {
    console.error('✗ Could not parse a project ref out of SUPABASE_URL')
    process.exit(2)
  }
  return m[1]
})()

const secretKey = required('SUPABASE_SECRET_KEY')
const databaseUrl = required('DATABASE_URL')

// ── Fetch metrics ────────────────────────────────────────────────────
const res = await fetch(
  `https://${projectRef}.supabase.co/customer/v1/privileged/metrics`,
  {
    headers: {
      authorization: `Basic ${Buffer.from(`service_role:${secretKey}`).toString('base64')}`,
    },
  },
)
if (!res.ok) {
  console.error(`✗ Metrics API returned ${res.status} ${res.statusText}`)
  console.error('  The service_role key must be the secret key (sb_secret_… or the legacy JWT).')
  process.exit(2)
}
const text = await res.text()

const dbSizeBytes = metric(text, 'pg_database_size_bytes', 'datname="postgres"')
const transmitBytes = metric(text, 'db_transmit_bytes')
const authUsers = metric(text, 'auth_users_user_count')
const realtimeSubs = metric(text, 'realtime_postgres_changes_total_subscriptions')

if (dbSizeBytes === null || transmitBytes === null) {
  console.error('✗ Metrics response did not contain the expected series.')
  console.error('  Supabase may have renamed them; check the raw endpoint output.')
  process.exit(2)
}

// ── Business counts + snapshot history ───────────────────────────────
const sql = postgres(databaseUrl, { max: 1, prepare: false })

const [{ n: tenants }] = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM tenants`
const [{ n: branches }] = await sql<{ n: number }[]>`
  SELECT count(*)::int AS n FROM branches`

const [prev] = await sql<
  { captured_at: Date; transmit_bytes: string; db_size_bytes: string }[]
>`
  SELECT captured_at, transmit_bytes, db_size_bytes
  FROM ops_usage_snapshots ORDER BY captured_at DESC LIMIT 1`

// ── Egress rate ──────────────────────────────────────────────────────
let projectedMonthly: number | null = null
let windowNote = 'no previous snapshot yet — run again later to get a rate'

if (prev) {
  const prevBytes = Number(prev.transmit_bytes)
  const elapsedMs = Date.now() - new Date(prev.captured_at).getTime()
  const elapsedDays = elapsedMs / 86_400_000
  if (transmitBytes < prevBytes) {
    windowNote = 'counter reset since last snapshot (instance restart) — rate skipped this run'
  } else if (elapsedDays < 0.02) {
    windowNote = 'previous snapshot is under 30 minutes old — too short to extrapolate'
  } else {
    const delta = transmitBytes - prevBytes
    projectedMonthly = (delta / elapsedDays) * 30
    windowNote = `${fmtBytes(delta)} over ${elapsedDays.toFixed(2)} days`
  }
}

// ── Report ───────────────────────────────────────────────────────────
type Row = { label: string; value: string; pct: number | null; warn: boolean }
const rows: Row[] = []

const dbPct = dbSizeBytes / LIMITS.dbBytes
rows.push({
  label: 'Database size',
  value: `${fmtBytes(dbSizeBytes)} / ${fmtBytes(LIMITS.dbBytes)}`,
  pct: dbPct,
  warn: dbPct >= WARN_AT,
})

const egressPct =
  projectedMonthly === null ? null : projectedMonthly / LIMITS.egressBytesPerMonth
rows.push({
  label: 'Egress (projected 30d)',
  value:
    projectedMonthly === null
      ? `unknown — ${windowNote}`
      : `${fmtBytes(projectedMonthly)} / ${fmtBytes(LIMITS.egressBytesPerMonth)}`,
  pct: egressPct,
  warn: egressPct !== null && egressPct >= WARN_AT,
})

if (authUsers !== null) {
  const p = authUsers / LIMITS.authUsers
  rows.push({
    label: 'Auth users',
    value: `${authUsers} / ${LIMITS.authUsers}`,
    pct: p,
    warn: p >= WARN_AT,
  })
}

console.log(`\nSupabase usage — project ${projectRef}`)
console.log('─'.repeat(64))
for (const r of rows) {
  const pct = r.pct === null ? '   —' : `${(r.pct * 100).toFixed(1).padStart(5)}%`
  console.log(`${r.warn ? '⚠' : '✓'} ${r.label.padEnd(24)} ${pct}  ${r.value}`)
}

console.log('─'.repeat(64))
console.log(`  tenants: ${tenants}   branches: ${branches}`)
if (projectedMonthly !== null) console.log(`  egress window: ${windowNote}`)

// Regression tripwire, not a capacity metric — see migration 0142.
const realtimeWarn = (realtimeSubs ?? 0) > 0
if (realtimeWarn) {
  console.log(
    `\n⚠ realtime_postgres_changes_total_subscriptions = ${realtimeSubs} (expected 0)\n` +
      '  Something re-subscribed to postgres_changes after the 0142 teardown.\n' +
      '  That is the pattern that exhausted JuraganQu\'s egress — investigate before it compounds.',
  )
}

// ── Record + exit ────────────────────────────────────────────────────
if (!DRY) {
  await sql`
    INSERT INTO ops_usage_snapshots
      (db_size_bytes, transmit_bytes, auth_users, realtime_subscriptions, tenants, branches)
    VALUES (${dbSizeBytes}, ${transmitBytes}, ${authUsers ?? 0}, ${realtimeSubs ?? 0}, ${tenants}, ${branches})`
  console.log('\nsnapshot recorded.')
} else {
  console.log('\n--dry: nothing written.')
}

await sql.end()

const tripped = rows.filter((r) => r.warn).map((r) => r.label)
if (realtimeWarn) tripped.push('Realtime subscriptions')

if (tripped.length) {
  console.error(`\n✗ AT OR OVER ${WARN_AT * 100}% — ${tripped.join(', ')}`)
  console.error('  Time to compare a self-hosted VPS against Supabase Pro.')
  process.exit(1)
}
console.log('\n✓ all metrics under threshold.')
