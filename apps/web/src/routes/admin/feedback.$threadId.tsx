/**
 * JUR-148: Admin feedback thread detail. Full-page mirror of
 * `/help/feedback/$threadId` for the tenant side. Reachable from
 * /admin/feedback by clicking a thread row.
 *
 * Public threads (source='public') trigger a Brevo email to the
 * submitter's address when admin replies. In-app threads fan out the
 * existing in-app notification.
 */
import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Globe2, Mail, Send } from 'lucide-react'
import {
  getAdminFeedbackThread,
  replyAsAdmin,
  setFeedbackStatus,
} from '@/server/functions/admin-feedback'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

export const Route = createFileRoute('/admin/feedback/$threadId')({
  loader: ({ params }) =>
    getAdminFeedbackThread({ data: { threadId: params.threadId } }),
  component: AdminFeedbackThreadPage,
})

const STATUS_LABEL: Record<string, string> = {
  open: 'Menunggu',
  replied: 'Dibalas',
  resolved: 'Selesai',
}

const STATUS_CLASS: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  replied: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400',
  resolved: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

function AdminFeedbackThreadPage() {
  const { thread, messages } = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()

  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  async function handleReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim()) return
    setSending(true)
    try {
      await replyAsAdmin({ data: { threadId: thread.id, body: reply.trim() } })
      setReply('')
      await router.invalidate()
    } catch (err) {
      toast({
        title: 'Gagal mengirim balasan',
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      })
    } finally {
      setSending(false)
    }
  }

  async function handleStatusChange(
    status: 'open' | 'replied' | 'resolved',
  ) {
    try {
      await setFeedbackStatus({ data: { threadId: thread.id, status } })
      await router.invalidate()
    } catch {
      toast({ title: 'Gagal mengubah status', variant: 'error' })
    }
  }

  const isPublic = thread.source === 'public'

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link
          to="/admin/feedback"
          className="mt-0.5 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
              {thread.subject}
            </h1>
            {isPublic && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
                <Globe2 className="h-3 w-3" /> Publik
              </span>
            )}
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[thread.status] ?? STATUS_CLASS.open}`}
            >
              {STATUS_LABEL[thread.status] ?? thread.status}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            Dibuat{' '}
            {formatDistanceToNow(new Date(thread.createdAt), {
              addSuffix: true,
              locale: idLocale,
            })}
          </p>
        </div>
      </div>

      {/* Sender + status control */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        {isPublic ? (
          <span className="flex items-center gap-1.5">
            <Globe2 className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {thread.publicName ?? 'Tamu'}
            </span>
            {thread.publicEmail && (
              <a
                href={`mailto:${thread.publicEmail}`}
                className="text-brand-700 hover:underline dark:text-brand-400"
              >
                &lt;{thread.publicEmail}&gt;
              </a>
            )}
          </span>
        ) : (
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {thread.tenantName ?? 'Tenant'}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-xs">
          <span>Status:</span>
          <select
            value={thread.status}
            onChange={(e) =>
              handleStatusChange(e.target.value as 'open' | 'replied' | 'resolved')
            }
            className="rounded border border-gray-300 bg-white px-2 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="open">Menunggu</option>
            <option value="replied">Dibalas</option>
            <option value="resolved">Selesai</option>
          </select>
        </span>
      </div>

      {/* Messages */}
      <div className="space-y-3">
        {messages.map((msg) => {
          const isAdmin = msg.senderType === 'admin'
          const senderLabel = isAdmin
            ? 'Tim Vintra'
            : isPublic
              ? (thread.publicName ?? 'Tamu')
              : (thread.tenantName ?? 'Tenant')
          return (
            <div
              key={msg.id}
              className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  isAdmin
                    ? 'rounded-tr-sm bg-brand-600 text-white'
                    : 'rounded-tl-sm bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                }`}
              >
                <p
                  className={`mb-1 text-xs font-semibold ${
                    isAdmin ? 'text-brand-100' : 'text-brand-600 dark:text-brand-400'
                  }`}
                >
                  {senderLabel}
                </p>
                <p className="whitespace-pre-wrap">{msg.body}</p>
                <p
                  className={`mt-1 text-right text-xs ${
                    isAdmin ? 'text-brand-200' : 'text-gray-400'
                  }`}
                >
                  {formatDistanceToNow(new Date(msg.createdAt), {
                    addSuffix: true,
                    locale: idLocale,
                  })}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Reply composer — hidden when resolved */}
      {thread.status !== 'resolved' && (
        <div className="space-y-2">
          {isPublic && thread.publicEmail && (
            <p className="flex items-center gap-1.5 text-xs text-primary-700 dark:text-primary-400">
              <Mail className="h-3.5 w-3.5" />
              Balasan akan dikirim ke{' '}
              <span className="font-medium">{thread.publicEmail}</span> via email.
            </p>
          )}
          <form onSubmit={handleReply} className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={4}
              placeholder={
                isPublic ? 'Tulis balasan email...' : 'Tulis balasan sebagai admin...'
              }
              className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
            />
            <Button
              type="submit"
              disabled={sending || !reply.trim()}
              className="shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
