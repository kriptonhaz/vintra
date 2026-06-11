import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

// Use max 1 connection for migrations
const sql = postgres(connectionString, { max: 1, prepare: false })
const db = drizzle(sql)

console.log('Running migrations...')
await migrate(db, { migrationsFolder: './src/migrations' })
console.log('Migrations applied successfully')
await sql.end()
