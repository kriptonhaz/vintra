import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { MessageSquare, Plus, ChevronRight } from 'lucide-react'
import {
  listFeedbackThreads,
  createFeedbackThread,
} from '@/server/functions/feedback'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatDistanceToNow } from 'date-fns'
import { id as idLocale } from 'date-fns/locale'

export const Route = createFileRoute('/_authed/help/feedback/')({
  loader: () => listFeedbackThreads(),
  component: FeedbackPage,
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

function FeedbackPage() {
  const threads = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()

  const [showDialog, setShowDialog] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!subject.trim() || !body.trim()) return
    setLoading(true)
    try {
      await createFeedbackThread({ data: { subject: subject.trim(), body: body.trim() } })
      toast({ title: 'Feedback terkirim', description: 'Kami akan segera merespons.' })
      setSubject('')
      setBody('')
      setShowDialog(false)
      await router.invalidate()
    } catch {
      toast({ title: 'Gagal mengirim', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Feedback & Bantuan</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Kirim pertanyaan, laporan bug, atau saran ke tim Vintra.
          </p>
        </div>
        <Button variant="brand" onClick={() => setShowDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Kirim Feedback
        </Button>
      </div>

      {threads.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <MessageSquare className="h-10 w-10 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Belum ada feedback. Klik "Kirim Feedback" untuk memulai.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
          {threads.map((t) => (
            <Link
              key={t.id}
              to="/help/feedback/$threadId"
              params={{ threadId: t.id }}
              className="flex items-center gap-4 px-4 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/40"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-gray-900 dark:text-gray-100">{t.subject}</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {formatDistanceToNow(new Date(t.lastMessageAt), {
                    addSuffix: true,
                    locale: idLocale,
                  })}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[t.status] ?? STATUS_CLASS.open}`}
              >
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
            </Link>
          ))}
        </div>
      )}

      <Dialog open={showDialog} onClose={() => setShowDialog(false)} placement="center">
        <DialogHeader>
          <DialogTitle>Kirim Feedback Baru</DialogTitle>
          <DialogDescription>
            Ceritakan kendala atau saran Anda agar tim Vintra bisa membantu.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Subjek
              </label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Contoh: Bug pada halaman kasir"
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Pesan
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                required
                placeholder="Jelaskan masalah atau saran Anda..."
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:placeholder-gray-500"
              />
            </div>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
              Batal
            </Button>
            <Button
              type="submit"
              variant="brand"
              loading={loading}
              disabled={!subject.trim() || !body.trim()}
            >
              Kirim
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </div>
  )
}
