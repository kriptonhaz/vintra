/**
 * Server functions for the WhatsApp module (JUR-31).
 * Wraps fetch calls to apps/api with the user's Supabase access token.
 *
 * Auth model (JUR-84):
 *   - requireWAAccess       → read endpoints. Gates on `whatsapp.read`
 *     (owner/admin/supervisor).
 *   - requireWAManageAccess → write/mutation endpoints. Gates on
 *     `whatsapp.manage` (owner/admin only). Includes sending messages,
 *     pairing instances, and editing AI/RAG/handoff configuration —
 *     anything a supervisor shouldn't trigger as a side-effect of
 *     monitoring chats.
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { requireWAAccess, requireWAManageAccess } from '../middleware/module-access'
import { getRequestHeaders } from '@tanstack/react-start/server'

function apiUrl(path: string) {
  const base = process.env['API_URL'] ?? 'http://localhost:4000'
  return `${base}/v1${path}`
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = getRequestHeaders()
  const auth = headers.get?.('authorization') ?? headers['authorization'] ?? ''
  const cookie = headers.get?.('cookie') ?? headers['cookie'] ?? ''

  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(text)
  }
  // 204 No Content + handlers that intentionally return empty bodies
  // (e.g. POST .../contacts/read) — return null instead of choking on
  // res.json() of an empty body.
  if (res.status === 204) return null
  const text = await res.text()
  if (!text) return null
  return JSON.parse(text)
}

export const listWaInstances = createServerFn({ method: 'POST' }).handler(async () => {
  await requireWAAccess()
  return apiFetch('/wa/instances')
})

export const connectWaInstance = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    return apiFetch(`/wa/instances/${data.id}/connect`, { method: 'POST' })
  })

export const pairWaInstanceWithCode = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid(), phone: z.string().min(8).max(32) }))
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    return apiFetch(`/wa/instances/${data.id}/pair-code`, {
      method: 'POST',
      body: JSON.stringify({ phone: data.phone }),
    })
  })

export const disconnectWaInstance = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    return apiFetch(`/wa/instances/${data.id}/disconnect`, { method: 'POST' })
  })

export const getWaInstanceStatus = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireWAAccess()
    return apiFetch(`/wa/instances/${data.id}/status`)
  })

export const createWaInstance = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ label: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    return apiFetch('/wa/instances', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  })

export const deleteWaInstance = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    return apiFetch(`/wa/instances/${data.id}`, { method: 'DELETE' })
  })

export const sendWaMessage = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ instanceId: z.string().uuid(), to: z.string(), body: z.string() }))
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    return apiFetch(`/wa/instances/${data.instanceId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ to: data.to, body: data.body }),
    })
  })

export const listWaMessages = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ instanceId: z.string().uuid(), jid: z.string() }))
  .handler(async ({ data }) => {
    await requireWAAccess()
    return apiFetch(`/wa/instances/${data.instanceId}/messages?jid=${encodeURIComponent(data.jid)}`)
  })

export const listWaContacts = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ instanceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireWAAccess()
    return apiFetch(`/wa/instances/${data.instanceId}/contacts`)
  })

export const markWaContactRead = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ instanceId: z.string().uuid(), jid: z.string() }))
  .handler(async ({ data }) => {
    // Marking a contact as read is a side-effect of viewing the chat,
    // so it sits with the read gate — otherwise supervisors browsing
    // conversations would leave unread badges stuck for the owner.
    await requireWAAccess()
    return apiFetch(`/wa/instances/${data.instanceId}/contacts/read`, {
      method: 'POST',
      body: JSON.stringify({ jid: data.jid }),
    })
  })

export const getWaInstance = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireWAAccess()
    return apiFetch(`/wa/instances/${data.id}`)
  })

export const updateWaInstance = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      label: z.string().min(1).max(100).optional(),
      aiEnabled: z.boolean().optional(),
      aiProvider: z.enum(['openai', 'gemini']).optional(),
      aiModel: z.string().optional(),
      aiSystemPrompt: z.string().optional(),
      aiTemperature: z.string().optional(),
      aiMaxHistory: z.number().int().min(1).max(50).optional(),
      aiProviderConfigId: z.union([z.string().uuid(), z.literal('')]).optional(),
      // JUR-74: handoff to admin
      adminPhone: z.string().optional(),
      handoffAutoResumeHours: z.number().int().min(0).max(168).optional(),
      // Per-instance toggle for the staff WhatsApp OTP login flow.
      // Owner-controlled from the instance config sheet. Off by default;
      // the inbound detector short-circuits when this is false.
      otpLoginEnabled: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    const { id, ...body } = data
    return apiFetch(`/wa/instances/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  })

// JUR-76 — outbound image send. Operator picks a file in the composer,
// the browser converts to a base64 data URL and posts it through this
// server fn. We:
//   1. Parse the data URL → bytes + mime
//   2. Upload to S3 with kind=wa-media (existing helper)
//   3. POST the resulting key + caption to the API
// Steps 1+2 happen on the web server (where the AWS creds live);
// step 3's payload is small JSON (the API never sees the bytes).
export const sendWaImage = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      instanceId: z.string().uuid(),
      to: z.string().min(1),
      caption: z.string().max(4000).optional(),
      // base64 data URL produced client-side via FileReader
      dataUrl: z.string().startsWith('data:'),
    }),
  )
  .handler(async ({ data }) => {
    const auth = await requireWAManageAccess()
    const { parseDataUrl, uploadWaMediaOutbound } = await import('@/lib/s3-storage')
    const { bytes, mimeType } = parseDataUrl(data.dataUrl)
    const outboundId = crypto.randomUUID()
    const { key } = await uploadWaMediaOutbound({
      tenantId: auth.tenantId,
      instanceId: data.instanceId,
      outboundId,
      bytes,
      mimeType,
    })
    return apiFetch(`/wa/instances/${data.instanceId}/messages/image`, {
      method: 'POST',
      body: JSON.stringify({
        to: data.to,
        caption: data.caption ?? '',
        s3Key: key,
        mime: mimeType,
        sizeBytes: bytes.byteLength,
      }),
    })
  })

// JUR-77 — fetch a short-lived signed S3 URL for media in a wa_messages
// row. Tenant-scoped: the message must belong to the caller's tenant.
// Returns null when the row has no media OR when the S3 object is gone
// (3-day lifecycle elapsed) — UI shows "Media tidak tersedia".
//
// We don't fetch via the API because the S3 IAM creds live in the web
// app env. The API has a Go S3 client too (JUR-75) but it's only used
// for upload/download in workers; signing is cleanest here where the
// existing TS helper already exists.
export const getWaMediaUrl = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ messageId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const auth = await requireWAAccess()
    // Hit the API to get the message — it already enforces tenant
    // scope on listWaMessages. We add a lightweight GET for one row.
    const msg = (await apiFetch(`/wa/messages/${data.messageId}`)) as {
      tenantId: string
      mediaKey: string | null
      mediaMime: string | null
    } | null
    if (!msg || !msg.mediaKey) return null
    if (msg.tenantId !== auth.tenantId) return null
    // Defer the actual sign until here so unauthorized callers never
    // touch S3.
    const { getWaMediaSignedUrl } = await import('@/lib/s3-storage')
    try {
      const url = await getWaMediaSignedUrl(msg.mediaKey)
      return { url, mime: msg.mediaMime ?? 'application/octet-stream' }
    } catch {
      // S3 returned 404 (lifecycle deletion) or signing failed.
      return null
    }
  })

// JUR-74: toggle a contact's handoff state (manual "Aktifkan kembali AI"
// button in the chat detail banner). The body's `enabled=true` puts the
// contact INTO handoff (rare from UI; usually set by the worker), while
// `enabled=false` clears it so the AI resumes autoreplying.
export const updateContactHandoff = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      instanceId: z.string().uuid(),
      remoteJid: z.string().min(1),
      enabled: z.boolean(),
      reason: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    // JID lives in the body, NOT the path. WhatsApp JIDs contain `.`
    // which Fiber treats as a route delimiter — putting them in the
    // path silently truncated the suffix and matched zero contacts.
    return apiFetch(`/wa/instances/${data.instanceId}/contacts/handoff`, {
      method: 'PATCH',
      body: JSON.stringify({
        remoteJid: data.remoteJid,
        enabled: data.enabled,
        reason: data.reason,
      }),
    })
  })

export const getAiMonthlyUsage = createServerFn({ method: 'POST' }).handler(async () => {
  await requireWAAccess()
  return apiFetch('/ai/usage/monthly')
})

export type WaSubscription = {
  tier: string
  maxInstances: number
  maxMonthlyReplies: number
  usedReplies: number
  subscriptionExpiresAt: string | null
}

export const getWaSubscription = createServerFn({ method: 'POST' }).handler(async () => {
  await requireWAAccess()
  return apiFetch('/wa/subscription') as Promise<WaSubscription>
})

export const listAvailableAiProviders = createServerFn({ method: 'POST' }).handler(async () => {
  await requireWAAccess()
  return apiFetch('/ai/providers') as Promise<
    Array<{
      id: string
      name: string
      providerType: 'openai' | 'gemini'
      model: string
      isDefault: boolean
    }>
  >
})

export type InstanceRagTool = {
  id: string
  name: string
  description?: string
  retrievalType: string
  minTier: string
  triggerMode: string
  triggerKeywords: string[]
  enabled: boolean
  locked: boolean
}

export const getInstanceRagTools = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ instanceId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireWAAccess()
    return apiFetch(`/wa/instances/${data.instanceId}/rag-tools`) as Promise<InstanceRagTool[]>
  })

export const updateInstanceRagTool = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      instanceId: z.string().uuid(),
      toolId: z.string().uuid(),
      enabled: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    await requireWAManageAccess()
    return apiFetch(`/wa/instances/${data.instanceId}/rag-tools/${data.toolId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: data.enabled }),
    })
  })
