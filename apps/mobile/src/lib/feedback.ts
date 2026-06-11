/**
 * Feedback / Help thread hooks — drives the /feedback list + detail
 * screens. Mirrors the web's tenant-side /help/feedback flow:
 *
 *   - listFeedbackThreads → list of the current tenant's threads
 *   - getFeedbackThread   → thread + messages (also bumps
 *                            tenantLastViewedAt server-side, so the
 *                            list query needs to re-sync on close)
 *   - createFeedbackThread → new thread + first message
 *   - addFeedbackMessage   → reply on an existing thread
 *
 * Admin-side fns (`replyAsAdmin`, etc.) intentionally NOT exposed on
 * mobile — admin uses the web dashboard.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { callServerFn } from './api'
import { useTenant } from './tenant-context'

export type FeedbackStatus = 'open' | 'replied' | 'resolved'
export type FeedbackSenderType = 'tenant' | 'admin' | 'public'

export interface FeedbackThread {
  id: string
  tenantId: string | null
  source: 'in_app' | 'public'
  subject: string
  status: FeedbackStatus
  publicEmail: string | null
  publicName: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  tenantLastViewedAt: string | null
  submitterIp: string | null
}

export interface FeedbackMessage {
  id: string
  threadId: string
  senderType: FeedbackSenderType
  senderUserId: string | null
  body: string
  createdAt: string
  emailSentAt: string | null
}

/**
 * True when the thread has activity newer than the tenant's last view.
 * Since the only non-tenant sender on a tenant thread is the admin,
 * this is effectively "an admin replied since you last looked".
 */
export function isThreadUnread(thread: FeedbackThread): boolean {
  if (!thread.lastMessageAt) return false
  const viewed = thread.tenantLastViewedAt
    ? new Date(thread.tenantLastViewedAt).getTime()
    : 0
  return new Date(thread.lastMessageAt).getTime() > viewed
}

export function useFeedbackThreads() {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['feedback', 'threads', tenantId],
    queryFn: () => callServerFn<FeedbackThread[]>('listFeedbackThreads'),
    enabled: !!tenantId,
  })
}

export function useFeedbackThread(threadId: string | null) {
  const { tenantId } = useTenant()
  return useQuery({
    queryKey: ['feedback', 'thread', tenantId, threadId],
    enabled: !!tenantId && !!threadId,
    queryFn: () =>
      callServerFn<{ thread: FeedbackThread; messages: FeedbackMessage[] }>(
        'getFeedbackThread',
        { threadId },
      ),
  })
}

export function useCreateFeedbackThread() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { subject: string; body: string }) =>
      callServerFn<FeedbackThread>('createFeedbackThread', input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['feedback', 'threads'] })
    },
  })
}

export function useAddFeedbackMessage() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { threadId: string; body: string }) =>
      callServerFn<FeedbackMessage>('addFeedbackMessage', input),
    onSuccess: (_msg, vars) => {
      void qc.invalidateQueries({
        queryKey: ['feedback', 'thread'],
      })
      void qc.invalidateQueries({ queryKey: ['feedback', 'threads'] })
      // Hint for callers that want optimistic refresh
      void vars
    },
  })
}
