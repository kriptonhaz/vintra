/**
 * Platform-admin system monitoring snapshot (JUR-83).
 *
 * Returns a single point-in-time view of: VPS RAM, CPU load, disk
 * usage (root + api data dir), S3 bucket size grouped by tenant-prefix
 * "kind" buckets, and both process uptimes.
 *
 * The system metrics (RAM/CPU/disk) come from the **api** service via
 * the /v1/internal/system-metrics endpoint. This is critical for local
 * dev: we want admin to see PROD resources from anywhere, not the
 * laptop's resources when viewing from localhost. Fetching from the
 * api always reflects the api's host (= prod Lightsail).
 *
 * S3 stays in the web app — only this side has the AWS SDK creds.
 * S3 ListObjectsV2 is the expensive bit (~150ms + AWS bytes); cached
 * in a process-local Map with a 5-min TTL.
 */
import { createServerFn } from '@tanstack/react-start'
import {
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3'
import { requirePlatformAdmin } from '../middleware/platform-admin'

// ── S3 client (mirrors apps/web/src/lib/s3-storage.ts) ─────────────
// Kept module-local so we don't accidentally export it. The other helper
// uses the same pattern; if we ever refactor that out into a shared
// helper, this can switch over.
let s3: S3Client | null = null
function getS3(): { client: S3Client; bucket: string } {
  const bucket = process.env.AWS_S3_BUCKET
  if (!bucket) throw new Error('AWS_S3_BUCKET env var missing')
  if (s3) return { client: s3, bucket }
  const region = process.env.AWS_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing')
  }
  s3 = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
  return { client: s3, bucket }
}

// ── API system metrics fetch ───────────────────────────────────────

// Fetches RAM/CPU/disk from the api side. The api always runs on the
// prod Lightsail VPS, so this is the canonical "what's the server
// doing" view regardless of where the operator is viewing from.
//
// Returns null shape on failure — UI surfaces "Data tidak tersedia"
// per card.
interface ApiSystemMetrics {
  ram: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
    availableBytes: number
    cachedBytes: number
    pct: number
  }
  cpu: { load1: number; load5: number; load15: number; cores: number }
  diskRoot: {
    totalBytes: number
    usedBytes: number
    availableBytes: number
    pct: number
  } | null
  diskApiDataBytes: number | null
  generatedAt: string
}

async function fetchApiSystemMetrics(): Promise<ApiSystemMetrics | null> {
  const apiBase = process.env.API_URL ?? 'http://127.0.0.1:4099'
  const token = process.env.INTERNAL_SERVICE_TOKEN
  if (!token) {
    // Config gap — we can't auth to the api. Log + return null so the
    // UI shows "Data tidak tersedia" rather than crashing.
    console.warn(
      'admin-monitoring: INTERNAL_SERVICE_TOKEN unset; system metrics will be empty.',
    )
    return null
  }
  try {
    const res = await fetch(`${apiBase}/v1/internal/system-metrics`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const raw = (await res.json()) as {
      ram: {
        totalBytes: number
        usedBytes: number
        freeBytes: number
        availableBytes: number
        cachedBytes: number
        pct: number
      }
      cpu: { load1: number; load5: number; load15: number; cores: number }
      diskRoot:
        | {
            totalBytes: number
            usedBytes: number
            availableBytes: number
            pct: number
          }
        | null
        | undefined
      diskApiDataBytes: number | null | undefined
      generatedAt: string
    }
    return {
      ram: raw.ram,
      cpu: raw.cpu,
      diskRoot: raw.diskRoot ?? null,
      diskApiDataBytes: raw.diskApiDataBytes ?? null,
      generatedAt: raw.generatedAt,
    }
  } catch {
    return null
  }
}

// ── S3 aggregation ────────────────────────────────────────────────

interface S3Buckets {
  totalBytes: number
  byKind: Record<
    'attendance' | 'inventory' | 'finance' | 'wa-media' | 'pos' | 'members' | 'other',
    { bytes: number; objectCount: number }
  >
  objectCount: number
  truncated: boolean
  scannedAt: string
}

// Classify a key into one of our known "kind" buckets using PREFIX
// inspection — cheaper than per-object GetObjectTagging at 1k objects
// per ListObjectsV2 page. The classifications mirror the tags set in
// `apps/web/src/lib/s3-storage.ts`. If those tags drift, update here.
function classifyKey(
  key: string,
): keyof S3Buckets['byKind'] {
  const parts = key.split('/')
  // Expected layout: <tenantId>/<subdir>/...
  if (parts.length < 2) return 'other'
  const subdir = parts[1] ?? ''
  switch (subdir) {
    case 'wa':
      return 'wa-media'
    case 'inventory':
      return 'inventory'
    case 'finance':
      return 'finance'
    case 'members':
      return 'members'
    case 'pos':
      return 'pos'
    default:
      // Attendance is the legacy layout: <tenantId>/<staffId>/<date>_<slot>.jpg
      // We accept it as the default ELSE bucket so attendance photos
      // (which are the bulk of objects today) don't end up as 'other'.
      // If a UUID-looking subdir, treat as attendance.
      if (/^[0-9a-f-]{36}$/i.test(subdir)) return 'attendance'
      return 'other'
  }
}

const S3_CACHE_TTL_MS = 5 * 60 * 1000
let s3Cache: { result: S3Buckets; expiresAt: number } | null = null
// Cap pagination to keep one refresh bounded — 5 pages × 1000 keys.
// Beyond that we mark `truncated: true` and surface a warning in the UI.
const S3_MAX_PAGES = 5

async function fetchS3Buckets(): Promise<S3Buckets> {
  if (s3Cache && s3Cache.expiresAt > Date.now()) return s3Cache.result

  const { client, bucket } = getS3()
  const result: S3Buckets = {
    totalBytes: 0,
    byKind: {
      attendance: { bytes: 0, objectCount: 0 },
      inventory: { bytes: 0, objectCount: 0 },
      finance: { bytes: 0, objectCount: 0 },
      'wa-media': { bytes: 0, objectCount: 0 },
      pos: { bytes: 0, objectCount: 0 },
      members: { bytes: 0, objectCount: 0 },
      other: { bytes: 0, objectCount: 0 },
    },
    objectCount: 0,
    truncated: false,
    scannedAt: new Date().toISOString(),
  }

  let continuationToken: string | undefined
  for (let page = 0; page < S3_MAX_PAGES; page++) {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    )
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue
      const size = obj.Size ?? 0
      const kind = classifyKey(obj.Key)
      result.byKind[kind].bytes += size
      result.byKind[kind].objectCount += 1
      result.totalBytes += size
      result.objectCount += 1
    }
    if (!resp.IsTruncated) {
      continuationToken = undefined
      break
    }
    continuationToken = resp.NextContinuationToken
  }
  if (continuationToken) result.truncated = true

  s3Cache = { result, expiresAt: Date.now() + S3_CACHE_TTL_MS }
  return result
}

// ── API uptime via /healthz ───────────────────────────────────────

async function fetchApiUptime(): Promise<{ seconds: number; version: string | null }> {
  try {
    const apiBase = process.env.API_URL ?? 'http://127.0.0.1:4099'
    const res = await fetch(`${apiBase}/healthz`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return { seconds: 0, version: null }
    const data = (await res.json()) as { uptime?: number; version?: string }
    return { seconds: Number(data.uptime ?? 0), version: data.version ?? null }
  } catch {
    return { seconds: 0, version: null }
  }
}

// ── Public response shape ─────────────────────────────────────────

export interface AdminSystemMetrics {
  ram: {
    totalBytes: number
    usedBytes: number
    freeBytes: number
    availableBytes: number
    cachedBytes: number
    pct: number
  }
  cpu: { load1: number; load5: number; load15: number; cpus: number }
  diskRoot: {
    totalBytes: number
    usedBytes: number
    availableBytes: number
    pct: number
  } | null
  diskApiData: { bytes: number } | null
  s3: S3Buckets
  uptime: {
    webSeconds: number
    api: { seconds: number; version: string | null }
  }
  generatedAt: string
}

export const getAdminSystemMetrics = createServerFn({ method: 'POST' }).handler(
  async (): Promise<AdminSystemMetrics> => {
    await requirePlatformAdmin()

    // Everything in parallel — total wall time = slowest probe (S3 on
    // a cold cache hit, ~200-500ms; otherwise it's the api fetch).
    const [apiMetrics, s3Result, apiUptime] = await Promise.all([
      fetchApiSystemMetrics(),
      fetchS3Buckets(),
      fetchApiUptime(),
    ])

    // Default-empty shapes when the api fetch failed. Each UI card
    // separately handles the "0 / unavailable" state.
    const ram = apiMetrics?.ram ?? {
      totalBytes: 0,
      usedBytes: 0,
      freeBytes: 0,
      availableBytes: 0,
      cachedBytes: 0,
      pct: 0,
    }
    const cpu = apiMetrics?.cpu ?? { load1: 0, load5: 0, load15: 0, cores: 0 }
    const diskRoot = apiMetrics?.diskRoot ?? null
    const diskApiData =
      apiMetrics?.diskApiDataBytes != null
        ? { bytes: apiMetrics.diskApiDataBytes }
        : null

    return {
      ram,
      cpu: { load1: cpu.load1, load5: cpu.load5, load15: cpu.load15, cpus: cpu.cores },
      diskRoot,
      diskApiData,
      s3: s3Result,
      uptime: {
        webSeconds: Math.floor(process.uptime()),
        api: apiUptime,
      },
      generatedAt: new Date().toISOString(),
    }
  },
)
