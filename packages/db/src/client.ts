import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Use connection pooling URL from Supabase
// Use { prepare: false } for Supabase Transaction pool mode
//
// globalThis singleton — Vite + Bun HMR re-imports this module on
// every server-code change in dev, which without the cache creates
// a fresh postgres pool each time. The old pools sit idle and
// Supabase's PgBouncer eventually disconnects them; the next query
// from the dev server lands on a closed connection and surfaces as
// a bare "Failed query: …" with no useful context. Caching the
// pool on globalThis lets HMR re-import the module while keeping a
// single live pool across reloads. No-op in production (one boot,
// one pool, no HMR).
const globalForDb = globalThis as unknown as {
  __posgresClient?: ReturnType<typeof postgres>
}

const client =
  globalForDb.__posgresClient ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false,
    // Recycle idle connections before Supabase's transaction pooler
    // (PgBouncer) silently drops them. Without this, a socket that sat
    // idle between e.g. scheduler ticks gets killed pooler-side and the
    // next query fails with `read ETIMEDOUT`. 20s is well under the
    // pooler's idle cutoff, so we always reconnect on a fresh socket.
    idle_timeout: 20,
    // Fail a hung connect fast instead of blocking a request/cron tick.
    connect_timeout: 10,
    max: 10,
  })

if (!globalForDb.__posgresClient) {
  globalForDb.__posgresClient = client
}

export const db = drizzle({ client, schema })
