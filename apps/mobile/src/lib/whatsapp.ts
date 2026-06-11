/**
 * WhatsApp API hooks. Mirrors the web's WhatsApp module — wraps the
 * gateway-exposed server fns. The Go API behind these proxies streams
 * via webhook→DB, so the mobile UI polls a few endpoints on intervals:
 *
 *   - status:   every 2s during pairing, every 30s once connected
 *   - contacts: every 5s on the inbox
 *   - messages: every 3s on an open conversation
 *
 * Numbers/dates come back as ISO strings — the screens coerce as needed.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

// ─── Instances ─────────────────────────────────────────────────────

export type WaInstanceStatus =
  | 'disconnected'
  | 'connecting'
  | 'pairing'
  | 'connected'
  | string

export interface WaInstance {
  id: string
  label: string
  phoneNumber: string | null
  status: WaInstanceStatus
  aiEnabled: boolean
  createdAt: string
  /** Last-seen at, when reported by the Go provider. */
  lastSeenAt: string | null
}

export function useWaInstances() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wa', 'instances', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<WaInstance[]>('listWaInstances', {}, { tenantId }),
    refetchInterval: 10_000,
  })
}

export function useWaInstance(id: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wa', 'instance', tenantId, id],
    enabled: !!tenantId && !!id,
    queryFn: () =>
      callServerFn<WaInstance>('getWaInstance', { id }, { tenantId }),
  })
}

export interface WaInstanceStatusResponse {
  status: WaInstanceStatus
  pairingCode: string | null
  qr: string | null
  phoneNumber: string | null
  errorMessage: string | null
}

/** Polls every 2 seconds when `fast` (pairing), else 30 seconds. */
export function useWaInstanceStatus(
  id: string | null,
  opts: { fast?: boolean } = {},
) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wa', 'instance-status', tenantId, id],
    enabled: !!tenantId && !!id,
    refetchInterval: opts.fast ? 2_000 : 30_000,
    queryFn: () =>
      callServerFn<WaInstanceStatusResponse>(
        'getWaInstanceStatus',
        { id },
        { tenantId },
      ),
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: ['wa'] })
}

export function useCreateWaInstance() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (label: string) =>
      callServerFn<WaInstance>('createWaInstance', { label }, { tenantId }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useDeleteWaInstance() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'deleteWaInstance',
        { id },
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useConnectWaInstance() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'connectWaInstance',
        { id },
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function usePairWaInstanceWithCode() {
  const { tenantId } = useTenant()
  return useMutation({
    mutationFn: (input: { id: string; phone: string }) =>
      callServerFn<{ pairingCode: string }>(
        'pairWaInstanceWithCode',
        input,
        { tenantId },
      ),
  })
}

export function useDisconnectWaInstance() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      callServerFn<{ success: true }>(
        'disconnectWaInstance',
        { id },
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateWaInstance() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: string
      label?: string
      aiEnabled?: boolean
    }) =>
      callServerFn<WaInstance>('updateWaInstance', input, { tenantId }),
    onSuccess: () => invalidateAll(qc),
  })
}

// ─── Contacts (inbox) ──────────────────────────────────────────────

export interface WaContact {
  id: string
  remoteJid: string
  name: string | null
  pushName: string | null
  lastMessageAt: string | null
  lastBody: string | null
  lastFromMe: boolean | null
  lastType: string | null
  unreadCount: number
  needsHuman?: boolean
  handoffAt: string | null
  handoffReason: string | null
  handoffSummary: string | null
  masterCustomerId: string | null
  masterCustomerName: string | null
}

export function useWaContacts(instanceId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wa', 'contacts', tenantId, instanceId],
    enabled: !!tenantId && !!instanceId,
    refetchInterval: 5_000,
    queryFn: () =>
      callServerFn<WaContact[]>(
        'listWaContacts',
        { instanceId },
        { tenantId },
      ),
  })
}

export function useMarkWaContactRead() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { instanceId: string; jid: string }) =>
      callServerFn<{ success: true }>(
        'markWaContactRead',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useUpdateContactHandoff() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      instanceId: string
      jid: string
      needsHuman: boolean
      reason?: string | null
      summary?: string | null
    }) =>
      callServerFn<{ success: true }>(
        'updateContactHandoff',
        input,
        { tenantId },
      ),
    onSuccess: () => invalidateAll(qc),
  })
}

// ─── Messages ───────────────────────────────────────────────────────

export type WaMessageType =
  | 'text'
  | 'image'
  | 'sticker'
  | 'document'
  | 'audio'
  | 'video'
  | string

export type WaMessageStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'error'
  | string

export interface WaMessageReaction {
  emoji: string
  senderJid: string
}

export interface WaMessage {
  id: string
  remoteJid: string
  fromMe: boolean
  type: WaMessageType
  body: string | null
  status: WaMessageStatus
  errorMessage: string | null
  createdAt: string
  mediaKey: string | null
  mediaMime: string | null
  mediaSizeBytes: number | null
  reactions?: WaMessageReaction[]
}

export function useWaMessages(
  instanceId: string | null,
  jid: string | null,
) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wa', 'messages', tenantId, instanceId, jid],
    enabled: !!tenantId && !!instanceId && !!jid,
    refetchInterval: 3_000,
    queryFn: () =>
      callServerFn<WaMessage[]>(
        'listWaMessages',
        { instanceId, jid },
        { tenantId },
      ),
  })
}

export function useSendWaMessage() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      instanceId: string
      to: string
      body: string
    }) =>
      callServerFn<{ id: string }>('sendWaMessage', input, { tenantId }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useSendWaImage() {
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      instanceId: string
      to: string
      /** base64 data URL — `data:image/jpeg;base64,...` */
      dataUrl: string
      caption?: string
    }) =>
      callServerFn<{ id: string }>('sendWaImage', input, { tenantId }),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useWaMediaUrl(messageId: string | null, enabled = true) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wa', 'media-url', tenantId, messageId],
    enabled: !!tenantId && !!messageId && enabled,
    staleTime: 60 * 60 * 1000, // signed URL is 24h; cache 1h
    queryFn: () =>
      callServerFn<{ url: string } | null>(
        'getWaMediaUrl',
        { messageId },
        { tenantId },
      ),
  })
}

// ─── Subscription + quota ──────────────────────────────────────────

export interface WaSubscription {
  tier: 'basic' | 'komplit' | 'pro' | string
  instanceCap: number
  monthlyReplyCap: number | null
  /** True when the subscription is active. */
  active: boolean
  validUntil: string | null
  /** Convenience boolean from server (Komplit gating). */
  aiEnabled: boolean
}

export function useWaSubscription() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wa', 'subscription', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<WaSubscription>('getWaSubscription', {}, { tenantId }),
  })
}

export function useAiMonthlyUsage() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['wa', 'ai-usage', tenantId],
    enabled: !!tenantId,
    queryFn: () =>
      callServerFn<{
        used: number
        cap: number | null
        periodStart: string
        periodEnd: string
      }>('getAiMonthlyUsage', {}, { tenantId }),
  })
}
