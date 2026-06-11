/**
 * One-time script to baseline the drizzle migrations table.
 *
 * Run once:  bun run migrate:baseline
 * Then use:  bun run db:migrate
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const sql = postgres(connectionString, { max: 1, prepare: false })

// Migration that represents the full current schema
const baselineMigrations = [
  { tag: '0000_thick_lily_hollister', when: 1775972311442 },
]

try {
  // Ensure drizzle schema and table exist
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`
  await sql`
    CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `

  // Check if already baselined
  const existing = await sql`SELECT count(*)::int as cnt FROM drizzle."__drizzle_migrations"`
  if (existing[0]!.cnt > 0) {
    console.log('Migrations table already has entries — skipping baseline.')
    await sql.end()
    process.exit(0)
  }

  // Insert baseline records
  for (const m of baselineMigrations) {
    const content = fs.readFileSync(`./src/migrations/${m.tag}.sql`).toString()
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    await sql`
      INSERT INTO drizzle."__drizzle_migrations" (hash, created_at)
      VALUES (${hash}, ${m.when})
    `
    console.log(`Baselined: ${m.tag}`)
  }

  console.log('Baseline complete. You can now run: bun run db:migrate')
} catch (err) {
  console.error('Baseline failed:', err)
  process.exit(1)
} finally {
  await sql.end()
}
