/**
 * Diff the Drizzle schema (code) against the live database (reality).
 *
 *   bun run check:drift          # report, exit 1 on structural drift
 *   bun run check:drift --strict # also exit 1 on type-only differences
 *
 * Why this exists: `drizzle-kit generate` has been broken since June 2026 (the
 * meta snapshot history collides at 0004/0005 and is frozen at 19 tables), so
 * every migration since 0006 has been hand-written. Nothing has been checking
 * that the hand-written SQL actually matches the schema files. This does.
 *
 * It is also the gate on ever re-baselining the migration history: squashing
 * 144 migrations into one generated baseline is only safe if the schema and
 * the database already agree. On JuraganQu they did NOT — `materials` carried
 * a legacy `supplier` column that no migration created, and restoring a dump
 * failed with "column does not exist". Run this before trusting any squash.
 *
 * The Drizzle side is read through `getTableConfig`, i.e. Drizzle's own model
 * of the schema — never by parsing the TypeScript, which silently misses
 * tables whose declaration does not match whatever regex you guessed.
 */
import * as schema from '@vintra/db/schema'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import postgres from 'postgres'

const STRICT = process.argv.includes('--strict')

const databaseUrl = process.env['DATABASE_URL']
if (!databaseUrl) {
  console.error('✗ DATABASE_URL is not set')
  process.exit(2)
}

/**
 * Canonicalise a Postgres type so the two sides are comparable.
 *
 * Drizzle's `getSQLType()` and Postgres's `format_type()` describe the same
 * type differently ("numeric(15, 2)" vs "numeric(15,2)", "timestamp" vs
 * "timestamp without time zone"). These rules cover the spellings this schema
 * actually uses. Anything they miss shows up as a type difference, which is
 * reported separately and does not fail the run unless --strict — a
 * normalisation gap should not masquerade as drift.
 */
function normalizeType(t: string): string {
  let s = t.toLowerCase().trim()
  s = s.replace(/\s*,\s*/g, ',').replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')')
  s = s
    .replace(/^timestamp with time zone$/, 'timestamptz')
    .replace(/^timestamp without time zone$/, 'timestamp')
    .replace(/^time with time zone$/, 'timetz')
    .replace(/^time without time zone$/, 'time')
    .replace(/^character varying/, 'varchar')
    .replace(/^character/, 'char')
    .replace(/^double precision$/, 'float8')
    .replace(/^real$/, 'float4')
    .replace(/^boolean$/, 'bool')
    .replace(/^integer$/, 'int4')
    .replace(/^smallint$/, 'int2')
    .replace(/^bigint$/, 'int8')
    // serial types are integers with a sequence default at rest
    .replace(/^serial$/, 'int4')
    .replace(/^bigserial$/, 'int8')
    .replace(/^smallserial$/, 'int2')
  return s
}

// ── Expected: the Drizzle schema ─────────────────────────────────────
type Col = { name: string; type: string }
const expected = new Map<string, Map<string, Col>>()

for (const value of Object.values(schema)) {
  if (!(value instanceof PgTable)) continue
  const cfg = getTableConfig(value as never)
  const cols = new Map<string, Col>()
  for (const c of cfg.columns) {
    cols.set(c.name, { name: c.name, type: normalizeType(c.getSQLType()) })
  }
  expected.set(cfg.name, cols)
}

// ── Actual: the live database ────────────────────────────────────────
// Straight to pg_catalog: information_schema.data_type collapses every array
// to the useless string "ARRAY".
const sql = postgres(databaseUrl, { max: 1, prepare: false })
const rows = await sql<{ tbl: string; col: string; typ: string }[]>`
  SELECT c.relname AS tbl,
         a.attname AS col,
         format_type(a.atttypid, a.atttypmod) AS typ
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attnum > 0
    AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum`
await sql.end()

const actual = new Map<string, Map<string, Col>>()
for (const r of rows) {
  if (!actual.has(r.tbl)) actual.set(r.tbl, new Map())
  actual.get(r.tbl)!.set(r.col, { name: r.col, type: normalizeType(r.typ) })
}

// ── Compare ──────────────────────────────────────────────────────────
const missingTables: string[] = [] // in schema, not in DB
const extraTables: string[] = [] // in DB, not in schema
const missingCols: string[] = [] // in schema, not in DB — breaks at runtime
const extraCols: string[] = [] // in DB, not in schema — legacy drift
const typeDiffs: string[] = []

for (const [table, cols] of expected) {
  const live = actual.get(table)
  if (!live) {
    missingTables.push(table)
    continue
  }
  for (const [name, col] of cols) {
    const liveCol = live.get(name)
    if (!liveCol) {
      missingCols.push(`${table}.${name} (${col.type})`)
    } else if (liveCol.type !== col.type) {
      typeDiffs.push(`${table}.${name}: schema=${col.type}  db=${liveCol.type}`)
    }
  }
}

for (const [table, cols] of actual) {
  const want = expected.get(table)
  if (!want) {
    extraTables.push(table)
    continue
  }
  for (const name of cols.keys()) {
    if (!want.has(name)) extraCols.push(`${table}.${name} (${cols.get(name)!.type})`)
  }
}

// ── Report ───────────────────────────────────────────────────────────
const expCols = [...expected.values()].reduce((n, m) => n + m.size, 0)
const actCols = [...actual.values()].reduce((n, m) => n + m.size, 0)

console.log('\nSchema drift — Drizzle schema vs live database')
console.log('─'.repeat(64))
console.log(`  schema : ${expected.size} tables, ${expCols} columns`)
console.log(`  live   : ${actual.size} tables, ${actCols} columns`)
console.log('─'.repeat(64))

function section(title: string, items: string[], hint: string) {
  if (!items.length) {
    console.log(`✓ ${title}: none`)
    return
  }
  console.log(`\n⚠ ${title}: ${items.length}`)
  for (const i of items.slice(0, 40)) console.log(`    ${i}`)
  if (items.length > 40) console.log(`    … and ${items.length - 40} more`)
  console.log(`    → ${hint}`)
}

section('Tables in schema but missing from DB', missingTables,
  'a migration was never written or never applied — the app will fail at runtime')
section('Tables in DB but not in schema', extraTables,
  'legacy or manually-created tables; add them to the schema or drop them')
section('Columns in schema but missing from DB', missingCols,
  'a migration was never written or never applied — queries selecting these will error')
section('Columns in DB but not in schema', extraCols,
  'legacy columns like JuraganQu\'s materials.supplier; a squash would silently drop them')

if (typeDiffs.length) {
  console.log(`\n· Type differences: ${typeDiffs.length}${STRICT ? '' : ' (advisory)'}`)
  for (const d of typeDiffs.slice(0, 40)) console.log(`    ${d}`)
  if (typeDiffs.length > 40) console.log(`    … and ${typeDiffs.length - 40} more`)
  console.log('    → some may be normalisation gaps rather than real drift; eyeball before acting')
} else {
  console.log('✓ Type differences: none')
}

const structural =
  missingTables.length + extraTables.length + missingCols.length + extraCols.length

console.log('\n' + '─'.repeat(64))
if (structural === 0 && typeDiffs.length === 0) {
  console.log('✓ No drift. Schema and database agree exactly.')
  console.log('  Re-baselining the migration history would be safe from a drift standpoint.')
  process.exit(0)
}
if (structural === 0) {
  console.log(`✓ No structural drift. ${typeDiffs.length} type difference(s) to eyeball.`)
  process.exit(STRICT ? 1 : 0)
}
console.error(`✗ ${structural} structural difference(s) — do NOT squash migrations until resolved.`)
process.exit(1)
