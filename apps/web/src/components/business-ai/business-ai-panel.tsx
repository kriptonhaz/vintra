import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import logoWhite from '@/assets/images/logo-white.png'
import { Loader2, Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { askBusinessAi } from '@/server/functions/business-ai'

/**
 * Vintra AI chat panel. Full-screen takeover on mobile, floating
 * bottom-right card on lg+. Bubble styling mirrors the WhatsApp inbox
 * (`_authed/whatsapp/$id.tsx` MessageBubble): user right/brand,
 * assistant left/white.
 *
 * No persistence by design: `messages` lives in the FAB parent's state,
 * so the conversation survives open/close but clears on page reload.
 */

export interface AiChatMsg {
  role: 'user' | 'assistant'
  content: string
  /** Render as an error bubble (request failed / access denied). */
  error?: boolean
}

const EXAMPLE_QUESTIONS = [
  'Apa barang yang paling laku hari ini?',
  'Berapa total omset hari ini?',
  'Berapa omset bulan ini?',
]

export function BusinessAiPanel({
  messages,
  setMessages,
  onClose,
}: {
  messages: AiChatMsg[]
  setMessages: React.Dispatch<React.SetStateAction<AiChatMsg[]>>
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Keep the newest message in view.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, pending])

  // Escape closes, matching Sheet/Dialog behaviour.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function send(text: string) {
    const question = text.trim()
    if (!question || pending) return
    setDraft('')
    setPending(true)
    // Optimistic append — history INCLUDING this question is what the
    // server fn receives (it's stateless between calls).
    const history = [
      ...messages.filter((m) => !m.error),
      { role: 'user' as const, content: question },
    ]
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    try {
      const { reply } = await askBusinessAi({
        data: {
          messages: history.map(({ role, content }) => ({ role, content })),
        },
      })
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content:
            err instanceof Error
              ? err.message
              : 'Terjadi kesalahan. Coba lagi sebentar.',
          error: true,
        },
      ])
    } finally {
      setPending(false)
      textareaRef.current?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white shadow-2xl dark:bg-gray-900 lg:inset-auto lg:right-4 lg:bottom-20 lg:h-[600px] lg:max-h-[calc(100vh-6rem)] lg:w-[400px] lg:rounded-2xl lg:border lg:border-gray-200 dark:lg:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-900 dark:bg-black">
            <img src={logoWhite} alt="" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              Vintra AI
            </p>
            <p className="text-[11px] text-gray-500">
              Tanya apa saja soal bisnismu
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup Vintra AI"
          className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-900 dark:bg-black">
              <img src={logoWhite} alt="" className="h-9 w-9" />
            </span>
            <p className="max-w-[240px] text-sm text-gray-500">
              Tanyakan apa saja tentang penjualan, stok, kas, atau absensi
              usahamu.
            </p>
            <div className="flex flex-col gap-2">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className="rounded-full border border-brand-200 bg-brand-50 px-4 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {messages.map((msg, i) => (
              <li
                key={i}
                className={cn(
                  'flex flex-col',
                  msg.role === 'user' ? 'items-end' : 'items-start',
                )}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words shadow-sm',
                    msg.role === 'user'
                      ? 'rounded-br-md bg-brand-600 text-white'
                      : msg.error
                        ? 'rounded-bl-md border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300'
                        : 'rounded-bl-md border border-gray-100 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100',
                  )}
                >
                  {msg.content}
                </div>
              </li>
            ))}
            {pending && (
              <li className="flex items-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-gray-100 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                  <span className="text-xs text-gray-500">
                    Vintra AI sedang mengecek data…
                  </span>
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-gray-100 p-3 dark:border-gray-800">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(draft)
              }
            }}
            rows={1}
            placeholder="Tulis pertanyaanmu…"
            disabled={pending}
            className="max-h-28 min-h-[42px] flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={() => send(draft)}
            disabled={pending || !draft.trim()}
            aria-label="Kirim"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-gray-400">
          Riwayat chat terhapus saat halaman dimuat ulang.
        </p>
      </div>
    </div>
  )
}
