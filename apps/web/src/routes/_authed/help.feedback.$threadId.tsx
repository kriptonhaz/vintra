import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Send } from 'lucide-react'
import { getFeedbackThread, addFeedbackMessage } from '@/server/functions/feedback'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

export const Route = createFileRoute('/_authed/help/feedback/$threadId')({
  loader: ({ params }) => getFeedbackThread({ data: { threadId: params.threadId } }),
  component: FeedbackThreadPage,
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

function FeedbackThreadPage() {
  const { thread, messages } = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()

  const [reply, setReply] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleReply(e: React.FormEvent) {
    e.preventDefault()
    if (!reply.trim()) return
    setLoading(true)
    try {
      await addFeedbackMessage({ data: { threadId: thread.id, body: reply.trim() } })
      setReply('')
      await router.invalidate()
    } catch {
      toast({ title: 'Gagal mengirim balasan', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link
          to="/help/feedback"
          className="mt-0.5 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
              {thread.subject}
            </h1>
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

      {/* Messages */}
      <div className="space-y-3">
        {messages.map((msg) => {
          const isAdmin = msg.senderType === 'admin'
          return (
            <div
              key={msg.id}
              className={`flex ${isAdmin ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  isAdmin
                    ? 'rounded-tl-sm bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                    : 'rounded-tr-sm bg-brand-600 text-white'
                }`}
              >
                {isAdmin && (
                  <p className="mb-1 text-xs font-semibold text-brand-600 dark:text-brand-400">
                    Tim Vintra
                  </p>
                )}
                <p className="whitespace-pre-wrap">{msg.body}</p>
                <p
                  className={`mt-1 text-right text-xs ${
                    isAdmin ? 'text-gray-400' : 'text-brand-200'
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
        <form onSubmit={handleReply} className="flex items-end gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Tulis balasan..."
            className="flex-1 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
          />
          <Button type="submit" disabled={loading || !reply.trim()} className="shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  )
}
