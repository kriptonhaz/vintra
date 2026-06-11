import * as React from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { formatDate } from '@/lib/utils' // JUR-137
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Wifi,
  WifiOff,
  QrCode,
  Send,
  Loader2,
  Search,
  MessageCircle,
  ArrowLeft,
  CheckCheck,
  Check,
  Clock,
  AlertCircle,
  Lock,
  MessageSquare,
  Settings,
  UserCheck,
  AlertTriangle,
  PauseCircle,
  FileText,
  ImageIcon,
  Paperclip,
  X,
  Smile,
  KeyRound,
  Smartphone,
} from 'lucide-react'

// Lazy import the emoji picker so its ~25 KB chunk only ships when
// the smiley button is first clicked. Each chat detail page mount
// thereafter reuses the cached chunk.
const EmojiPicker = React.lazy(() => import('emoji-picker-react'))
import {
  connectWaInstance,
  pairWaInstanceWithCode,
  disconnectWaInstance,
  getWaInstanceStatus,
  getWaInstance,
  updateWaInstance,
  sendWaMessage,
  listWaMessages,
  listWaContacts,
  markWaContactRead,
  getInstanceRagTools,
  updateInstanceRagTool,
  updateContactHandoff,
  getWaMediaUrl,
  sendWaImage,
} from '@/server/functions/whatsapp'
import { getCurrentTenant } from '@/server/functions/tenant'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export const Route = createFileRoute('/_authed/whatsapp/$id')({
  // Stop /whatsapp/$id from rendering NotPairedGate when the instance
  // UUID in the URL doesn't exist in DB (stale link, copy-paste typo,
  // deleted instance). Probe the instance up-front and bounce to the
  // list if it's gone. The redirect must live OUTSIDE the try block —
  // TanStack Router's redirect() throws, and a wrapping catch would
  // swallow it.
  beforeLoad: async ({ params }) => {
    let exists = false
    try {
      await getWaInstance({ data: { id: params.id } })
      exists = true
    } catch {
      exists = false
    }
    if (exists) return
    throw redirect({ to: '/whatsapp' })
  },
  component: WhatsappDetailPage,
})

// Default system prompt template offered via the "Pakai template" button
// in Pengaturan AI. Generic enough for any business (warung / kafe / toko
// / jasa), specific enough to be useful out of the box.
//
// Important properties:
//   - Pre-fills `business_name` + `business_category` from the tenant's
//     onboarding so the operator doesn't have to retype them.
//   - Mentions "alihkan ke admin" verbatim — matches the heuristic
//     handoff detector regex, so escalations actually trigger the
//     admin notification flow.
//   - Caps emoji + length to keep DeepSeek cost predictable.
//   - Reminds the AI not to invent prices/promos — RAG data is the
//     source of truth.
//   - Does NOT mention jam buka — the branch hours RAG tool feeds
//     that into context automatically when enabled.
function buildSystemPromptTemplate(tenant: {
  businessName?: string | null
  businessCategory?: string | null
} | null | undefined): string {
  const name = tenant?.businessName?.trim() || 'toko ini'
  const category = tenant?.businessCategory?.trim()
  // First sentence adapts to whether we know the category. Skipping the
  // generic "toko ini" fallback when category is set keeps the prompt
  // tight without sounding awkward.
  const intro = category
    ? `Kamu adalah asisten customer service untuk ${name}, sebuah ${category}.`
    : `Kamu adalah asisten customer service untuk ${name}.`

  return `${intro} Jawablah pertanyaan pelanggan dengan ramah, singkat, dan jelas dalam Bahasa Indonesia santai.

GAYA BAHASA:
- Sapa pelanggan dengan "kak" atau "kakak".
- Maksimal 1–2 emoji per balasan. Hindari emoji berlebihan.
- Balas 2–4 kalimat. Tidak perlu paragraf panjang.

KETENTUAN:
- Pakai format harga "Rp 15.000" (titik sebagai pemisah ribuan).
- Jangan mengarang info produk, harga, stok, atau promo. Kalau tidak ada di data, alihkan ke admin.
- Jangan menjanjikan diskon, refund, atau perubahan harga atas inisiatif sendiri.

ALIHKAN KE ADMIN ketika:
- Pelanggan mau pesan/order dan butuh konfirmasi alamat, pembayaran, atau pengiriman.
- Pelanggan komplain, minta refund, atau ada masalah pesanan.
- Pertanyaan kompleks yang jawabannya tidak ada di data toko.
- Ucapkan dengan natural: "Aku alihkan ke admin ya kak biar lebih jelas 🙏"

Sesuaikan template ini dengan gaya komunikasi khas tokomu.`
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'Tersambung',
  connecting: 'Menyambung',
  qr: 'Menunggu pairing',
  disconnected: 'Terputus',
  logged_out: 'Logout',
  banned: 'Diblokir',
}

interface Contact {
  id: string
  remoteJid: string
  name?: string | null
  pushName?: string | null
  lastMessageAt?: string | null
  lastBody?: string | null
  lastFromMe?: boolean | null
  lastType?: string | null
  unreadCount: number
  // JUR-74: handoff metadata. needsHuman=true means the AI auto-reply
  // is paused for this contact until admin clears it (or the auto-resume
  // window elapses on the next inbound message).
  needsHuman?: boolean
  handoffAt?: string | null
  handoffReason?: string | null
  handoffSummary?: string | null
  // Master customer linkage. Joined server-side by normalised phone
  // (customers.phone canonical "628..." form). When present, UI shows
  // this name primary with the WhatsApp push_name as secondary so
  // operator sees "Bu Vinna · WA: Vinna A Y" instead of just the
  // push_name the customer set on their phone.
  masterCustomerId?: string | null
  masterCustomerName?: string | null
}

interface Message {
  id: string
  remoteJid: string
  fromMe: boolean
  type: string
  body?: string | null
  status: string
  errorMessage?: string | null
  createdAt: string
  // JUR-75 / JUR-77: media metadata. mediaKey populated for image /
  // sticker / document messages whose bytes were successfully uploaded
  // to S3. UI fetches a signed URL on-demand via getWaMediaUrl.
  mediaKey?: string | null
  mediaMime?: string | null
  mediaSizeBytes?: number | null
  // JUR-80: emoji reactions attached to this message. Each entry is
  // one (sender, emoji) pair — the API guarantees unique senders.
  // Absent when no one has reacted (the omitempty side of the API
  // response shape).
  reactions?: { emoji: string; senderJid: string }[]
}

type View = 'chat' | 'settings'

function WhatsappDetailPage() {
  const { id } = Route.useParams()
  const { toast } = useToast()
  const [view, setView] = React.useState<View>('chat')
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const [showQr, setShowQr] = React.useState(false)
  const [showPairCode, setShowPairCode] = React.useState(false)
  const [pairPhone, setPairPhone] = React.useState('')
  const [pairCode, setPairCode] = React.useState<string | null>(null)
  const [selectedJid, setSelectedJid] = React.useState<string | null>(null)
  const [search, setSearch] = React.useState('')
  const [composeText, setComposeText] = React.useState('')
  const [newJidInput, setNewJidInput] = React.useState('')
  const [showNewChat, setShowNewChat] = React.useState(false)
  // JUR-76 — pending image attachment. Holds the data URL for preview
  // + the original file name so the operator sees what they picked.
  // Cleared after a successful send or via the X button.
  const [pendingImage, setPendingImage] = React.useState<{
    dataUrl: string
    name: string
    sizeBytes: number
  } | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  // JUR-78 — emoji picker open state. Closes on outside click via
  // a click-away listener wired below; the smiley button toggles it.
  const [showEmoji, setShowEmoji] = React.useState(false)
  const emojiContainerRef = React.useRef<HTMLDivElement>(null)

  // JUR-78 — outside-click + Escape close the picker. Listen at
  // window level so the picker collapses regardless of where the
  // user clicked. Does nothing when picker is hidden.
  React.useEffect(() => {
    if (!showEmoji) return
    const onPointer = (e: MouseEvent) => {
      if (
        emojiContainerRef.current &&
        !emojiContainerRef.current.contains(e.target as Node)
      ) {
        setShowEmoji(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowEmoji(false)
    }
    window.addEventListener('mousedown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [showEmoji])

  // Insert at the textarea's current cursor position rather than
  // appending. Falls back to append if the textarea isn't mounted
  // (shouldn't happen but defensive).
  function insertEmojiAtCursor(emoji: string) {
    const ta = textareaRef.current
    if (!ta) {
      setComposeText((t) => t + emoji)
      return
    }
    const start = ta.selectionStart ?? composeText.length
    const end = ta.selectionEnd ?? composeText.length
    const next = composeText.slice(0, start) + emoji + composeText.slice(end)
    setComposeText(next)
    // Restore caret position after the inserted emoji on the next tick.
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + emoji.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const { data: instanceData } = useQuery({
    queryKey: ['wa-instance', id],
    queryFn: () => getWaInstance({ data: { id } }),
  })

  // Tenant profile is used to pre-fill the AI system prompt template
  // with the business name + jenis usaha captured at onboarding. Cached
  // forever — these don't change often, and the operator can refresh
  // the page if they update the tenant profile elsewhere.
  const { data: tenantProfile } = useQuery({
    queryKey: ['current-tenant'],
    queryFn: () => getCurrentTenant(),
    staleTime: 30 * 60 * 1000,
  })

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ['wa-status', id],
    queryFn: () => getWaInstanceStatus({ data: { id } }),
    // Poll fast (2s) only while waiting for pairing — the QR modal
    // wants to auto-close the moment the socket reports connected.
    // Once connected, drift is rare and 30s is plenty; this kills
    // ~93% of background request volume and gives the auth refresh
    // coalescer fewer chances to race.
    refetchInterval: (query) => {
      const s = (query.state.data as { status?: string } | undefined)?.status
      return s === 'connected' ? 30_000 : 2_000
    },
  })

  const status: string = statusData?.status ?? 'disconnected'
  const isConnected = status === 'connected'

  // Auto-close pairing modals as soon as the socket reports connected.
  React.useEffect(() => {
    if ((showQr || showPairCode) && status === 'connected') {
      setShowQr(false)
      setShowPairCode(false)
      setQrDataUrl(null)
      setPairCode(null)
      toast({ title: 'WhatsApp tersambung', variant: 'success' })
    }
  }, [showQr, showPairCode, status, toast])

  const { data: contacts = [], refetch: refetchContacts } = useQuery<Contact[]>({
    queryKey: ['wa-contacts', id],
    queryFn: () => listWaContacts({ data: { instanceId: id } }),
    refetchInterval: 5_000,
  })

  const { data: messages = [], refetch: refetchMessages } = useQuery<Message[]>({
    queryKey: ['wa-messages', id, selectedJid],
    queryFn: () => listWaMessages({ data: { instanceId: id, jid: selectedJid! } }),
    enabled: !!selectedJid,
    refetchInterval: 3_000,
  })

  const connect = useMutation({
    mutationFn: () => connectWaInstance({ data: { id } }),
    onSuccess: (res: { status: string; qr?: string }) => {
      // Branch on what the API actually returned. The handler can
      // respond with several terminal states; we don't want to claim
      // "Connected!" just because there's no QR (the timeout path
      // returns {status: 'connecting'} with no qr).
      if (res.qr) {
        setQrDataUrl(res.qr)
        setShowQr(true)
      } else if (res.status === 'connected') {
        toast({ title: 'Tersambung!', variant: 'success' })
      } else if (res.status === 'connecting') {
        toast({
          title: 'Menyambungkan…',
          description: 'Tunggu sebentar — status akan terupdate otomatis.',
        })
      }
      // status='logged_out' / 'disconnected' → no toast; the status
      // poll will refetch and the NotPairedGate copy explains what
      // to do next.
      refetchStatus()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal menyambungkan', description: e.message, variant: 'error' }),
  })

  const pairWithCode = useMutation({
    mutationFn: (phone: string) => pairWaInstanceWithCode({ data: { id, phone } }),
    onSuccess: (res: { status: string; code?: string }) => {
      if (res.code) {
        setPairCode(res.code)
      } else if (res.status === 'connected') {
        toast({ title: 'Tersambung!', variant: 'success' })
        setShowPairCode(false)
      } else if (res.status === 'connecting') {
        toast({
          title: 'Menyambungkan…',
          description: 'Tunggu sebentar, lalu coba tampilkan kode lagi.',
        })
      }
      refetchStatus()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal membuat kode', description: e.message, variant: 'error' }),
  })

  const disconnect = useMutation({
    mutationFn: () => disconnectWaInstance({ data: { id } }),
    onSuccess: () => {
      toast({ title: 'Terputus', variant: 'success' })
      refetchStatus()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal memutuskan', description: e.message, variant: 'error' }),
  })

  const send = useMutation({
    mutationFn: (args: { to: string; body: string }) =>
      sendWaMessage({ data: { instanceId: id, to: args.to, body: args.body } }),
    onSuccess: () => {
      setComposeText('')
      refetchMessages()
      refetchContacts()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal kirim', description: e.message, variant: 'error' }),
  })

  // JUR-76 — sendImage uses the dedicated server fn that uploads to
  // S3 then enqueues wa:send_image on the API.
  const sendImage = useMutation({
    mutationFn: (args: { to: string; caption: string; dataUrl: string }) =>
      sendWaImage({
        data: {
          instanceId: id,
          to: args.to,
          caption: args.caption,
          dataUrl: args.dataUrl,
        },
      }),
    onSuccess: () => {
      setComposeText('')
      setPendingImage(null)
      refetchMessages()
      refetchContacts()
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal kirim gambar', description: e.message, variant: 'error' }),
  })

  function handlePairCodeSubmit() {
    const phone = pairPhone.trim()
    if (!phone) return
    setPairCode(null)
    pairWithCode.mutate(phone)
  }

  function handleSend() {
    if (!selectedJid || !isConnected) return
    if (pendingImage) {
      sendImage.mutate({
        to: selectedJid,
        caption: composeText.trim(),
        dataUrl: pendingImage.dataUrl,
      })
      return
    }
    if (!composeText.trim()) return
    send.mutate({ to: selectedJid, body: composeText.trim() })
  }

  // 5 MB cap matches the server-side enforcement in s3-storage.ts.
  // Validating client-side too means we don't waste a round trip + S3
  // upload on a doomed file.
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024
  const ACCEPTED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp']

  async function handleImagePick(file: File) {
    if (!ACCEPTED_IMAGE_MIMES.includes(file.type)) {
      toast({
        title: 'Format tidak didukung',
        description: 'Gunakan JPG, PNG, atau WebP.',
        variant: 'error',
      })
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast({
        title: 'Ukuran terlalu besar',
        description: `Maksimal ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Coba kompres dulu.`,
        variant: 'error',
      })
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Gagal baca file.'))
      reader.readAsDataURL(file)
    })
    setPendingImage({ dataUrl, name: file.name, sizeBytes: file.size })
  }

  function handleStartNewChat() {
    const trimmed = newJidInput.trim()
    if (!trimmed) return
    // Normalise to JID. If user typed a phone number, append the suffix; the
    // server will re-normalise anyway, but selecting the same shape lets us
    // match the contact row immediately.
    const jid = trimmed.includes('@')
      ? trimmed
      : trimmed.replace(/\D/g, '').replace(/^0/, '62') + '@s.whatsapp.net'
    setSelectedJid(jid)
    setShowNewChat(false)
    setNewJidInput('')
  }

  const filteredContacts = React.useMemo(() => {
    if (!search.trim()) return contacts
    const q = search.toLowerCase()
    return contacts.filter((c) => {
      const display = (c.pushName || c.name || c.remoteJid).toLowerCase()
      return display.includes(q) || c.remoteJid.toLowerCase().includes(q)
    })
  }, [contacts, search])

  // If the user starts a new chat with a JID that isn't in the contact list
  // yet (e.g., first outbound to a number), surface it as a synthetic row at
  // the top so the conversation view has a header.
  const conversationContact = React.useMemo(() => {
    if (!selectedJid) return null
    const found = contacts.find((c) => c.remoteJid === selectedJid)
    if (found) return found
    return {
      id: 'synthetic',
      remoteJid: selectedJid,
      pushName: null,
      name: null,
      lastBody: null,
      lastFromMe: null,
      lastMessageAt: null,
      lastType: null,
      unreadCount: 0,
      needsHuman: false,
      handoffAt: null,
      handoffReason: null,
      handoffSummary: null,
      masterCustomerId: null,
      masterCustomerName: null,
    } as Contact
  }, [selectedJid, contacts])

  // Mark the conversation as read whenever the user opens it, AND
  // whenever new unread messages arrive while it's already open.
  const markRead = useMutation({
    mutationFn: (jid: string) =>
      markWaContactRead({ data: { instanceId: id, jid } }),
    onSuccess: () => refetchContacts(),
  })
  const selectedUnread = conversationContact?.unreadCount ?? 0
  React.useEffect(() => {
    if (selectedJid && selectedUnread > 0) {
      markRead.mutate(selectedJid)
    }
    // markRead.mutate is stable via useMutation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJid, selectedUnread])

  // Scroll messages to bottom whenever:
  //  - a new message arrives (messages changes)
  //  - the user switches conversation (selectedJid)
  //  - the chat panel re-mounts after flipping to Pengaturan AI and back
  //    (view changes back to 'chat' — the messages array and selectedJid
  //    may both be unchanged so we need `view` in the deps).
  //
  // useLayoutEffect runs synchronously before paint, avoiding a flash
  // of "stuck at top".
  const scrollRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    if (view !== 'chat') return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, selectedJid, view])

  const orderedMessages = React.useMemo(
    () => [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages],
  )

  return (
    <div className="-mx-4 -mt-22 -mb-6 flex h-[calc(100vh-0px)] flex-col bg-gray-50 sm:-mx-6 lg:-mx-8 dark:bg-gray-900">
      {/* Top bar */}
      <div className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <Link
              to="/whatsapp"
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {instanceData?.label ?? 'WhatsApp'}
              </h1>
              <div className="mt-0.5 flex items-center gap-1.5">
                {isConnected ? (
                  <Wifi className="h-3.5 w-3.5 text-brand-500" />
                ) : (
                  <WifiOff className="h-3.5 w-3.5 text-gray-400" />
                )}
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {STATUS_LABEL[status] ?? status}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {!isConnected ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Gunakan kode"
                  onClick={() => {
                    setPairCode(null)
                    setShowPairCode(true)
                  }}
                >
                  <KeyRound className="h-4 w-4" />
                  <span className="hidden sm:inline">Gunakan Kode</span>
                </Button>
                <Button
                  variant="brand"
                  size="sm"
                  aria-label="Pindai QR"
                  onClick={() => connect.mutate()}
                  loading={connect.isPending}
                >
                  <QrCode className="h-4 w-4" />
                  <span className="hidden sm:inline">Pindai QR</span>
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disconnect.mutate()}
                loading={disconnect.isPending}
              >
                Putuskan
              </Button>
            )}
          </div>
        </div>
        {/* View tabs */}
        <div className="flex border-t border-gray-100 px-4 dark:border-gray-700 lg:px-6">
          <button
            onClick={() => setView('chat')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              view === 'chat'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Chat
          </button>
          <button
            onClick={() => setView('settings')}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              view === 'settings'
                ? 'border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            <Settings className="h-4 w-4" />
            Pengaturan AI
          </button>
        </div>
      </div>

      {/* Settings view */}
      {view === 'settings' && (
        <div className="flex-1 overflow-y-auto">
          <AiSettingsPanel
            instanceId={id}
            instance={instanceData}
            tenant={tenantProfile}
          />
        </div>
      )}

      {/* Chat view */}
      {view === 'chat' && (
      <>
      {/* Until paired, hide the chat layout entirely and show a
          gate that walks the user through scanning the QR. The chat
          area only renders when status === 'connected'. */}
      {!isConnected ? (
        <NotPairedGate
          status={status}
          onConnect={() => connect.mutate()}
          onUseCode={() => {
            setPairCode(null)
            setShowPairCode(true)
          }}
          connecting={connect.isPending}
          pairingCode={pairWithCode.isPending}
        />
      ) : (
      /* Two-column chat area */
      <div className="flex min-h-0 flex-1">
        {/* Left: contact list */}
        <aside
          className={`flex w-full flex-col border-r border-gray-200 bg-white sm:w-80 dark:border-gray-700 dark:bg-gray-800 ${
            selectedJid ? 'hidden sm:flex' : 'flex'
          }`}
        >
          {/* Search + new chat */}
          <div className="space-y-2 border-b border-gray-100 p-3 dark:border-gray-700">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kontak…"
                className="pl-9"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => setShowNewChat(true)}
            >
              <MessageCircle className="h-4 w-4" />
              Chat baru
            </Button>
          </div>

          {/* Contact rows */}
          <div className="flex-1 overflow-y-auto">
            {filteredContacts.length === 0 ? (
              <EmptyContactList hasSearch={!!search} />
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredContacts.map((c) => (
                  <ContactRow
                    key={c.id}
                    contact={c}
                    selected={c.remoteJid === selectedJid}
                    onClick={() => setSelectedJid(c.remoteJid)}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Right: conversation */}
        <section
          className={`flex min-w-0 flex-1 flex-col ${
            selectedJid ? 'flex' : 'hidden sm:flex'
          }`}
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.04) 1px, transparent 0)',
            backgroundSize: '20px 20px',
          }}
        >
          {!selectedJid ? (
            <EmptyConversation />
          ) : (
            <>
              {/* Conversation header */}
              <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
                <button
                  onClick={() => setSelectedJid(null)}
                  className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 sm:hidden dark:text-gray-400 dark:hover:bg-gray-700"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <Avatar name={contactDisplayName(conversationContact)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {contactDisplayName(conversationContact)}
                  </p>
                  {/* When the contact is saved in master AND the WA
                      profile name differs, surface the WA name on a
                      second line so the operator confirms it's the
                      right person. Phone subtitle still shows below. */}
                  {contactSecondaryName(conversationContact) && (
                    <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                      WA: {contactSecondaryName(conversationContact)}
                    </p>
                  )}
                  <ContactSubtitle jid={conversationContact!.remoteJid} hasName={hasRealName(conversationContact)} />
                </div>
                {conversationContact && (
                  <HandoffToggleButton
                    instanceId={id}
                    contact={conversationContact}
                    aiEnabled={instanceData?.aiEnabled ?? false}
                    onOpenSettings={() => setView('settings')}
                  />
                )}
              </div>

              {/* Handoff banner (JUR-74) */}
              {conversationContact?.needsHuman && (
                <HandoffBanner
                  instanceId={id}
                  contact={conversationContact}
                  autoResumeHours={instanceData?.handoffAutoResumeHours ?? 24}
                  onResumed={() => {
                    refetchContacts()
                  }}
                />
              )}

              {/* Messages */}
              <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-3 py-4 sm:px-6"
              >
                {orderedMessages.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Belum ada pesan. Kirim pesan pertama di bawah.
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {orderedMessages.map((m, idx) => {
                      const prev = orderedMessages[idx - 1]
                      const showTimeGroup =
                        !prev || !isSameDay(prev.createdAt, m.createdAt)
                      return (
                        <React.Fragment key={m.id}>
                          {showTimeGroup && (
                            <li className="my-3 flex justify-center">
                              <span className="rounded-md bg-white/80 px-3 py-1 text-[11px] font-medium text-gray-500 shadow-sm dark:bg-gray-800/80 dark:text-gray-400">
                                {formatDateGroup(m.createdAt)}
                              </span>
                            </li>
                          )}
                          <MessageBubble msg={m} />
                        </React.Fragment>
                      )
                    })}
                  </ul>
                )}
              </div>

              {/* Composer */}
              <div className="border-t border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800 sm:px-4">
                {!isConnected && (
                  <p className="mb-1.5 text-center text-xs text-warning-700 dark:text-warning-400">
                    Hubungkan WhatsApp untuk mengirim pesan.
                  </p>
                )}
                {/* Pending image preview (JUR-76). Sits above the
                    textarea; caption typed below becomes the image
                    caption when sent. */}
                {pendingImage && (
                  <div className="mb-2 flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900/40">
                    <img
                      src={pendingImage.dataUrl}
                      alt={pendingImage.name}
                      className="h-14 w-14 shrink-0 rounded object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                        {pendingImage.name}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {(pendingImage.sizeBytes / 1024).toFixed(0)} KB · disimpan 24 jam
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPendingImage(null)}
                      className="rounded-full p-1 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
                      aria-label="Hapus gambar"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPTED_IMAGE_MIMES.join(',')}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleImagePick(file)
                      // Reset so picking the same file twice in a row
                      // still triggers onChange.
                      e.target.value = ''
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isConnected || sendImage.isPending}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
                    aria-label="Lampirkan gambar (media disimpan 24 jam)"
                    title="Lampirkan gambar — media otomatis dihapus setelah 24 jam"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>
                  {/* JUR-78 — emoji picker. The smiley button +
                      popover share a wrapper so the click-away
                      handler treats the picker contents as "inside". */}
                  <div className="relative" ref={emojiContainerRef}>
                    <button
                      type="button"
                      onClick={() => setShowEmoji((v) => !v)}
                      disabled={!isConnected}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700"
                      aria-label="Pilih emoji"
                      title="Pilih emoji"
                    >
                      <Smile className="h-5 w-5" />
                    </button>
                    {showEmoji && (
                      <div className="absolute bottom-12 left-0 z-30">
                        <React.Suspense
                          fallback={
                            <div className="flex h-80 w-72 items-center justify-center rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                            </div>
                          }
                        >
                          <EmojiPicker
                            width={300}
                            height={360}
                            onEmojiClick={(e) => {
                              insertEmojiAtCursor(e.emoji)
                              setShowEmoji(false)
                            }}
                            previewConfig={{ showPreview: false }}
                            skinTonesDisabled
                            lazyLoadEmojis
                          />
                        </React.Suspense>
                      </div>
                    )}
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={composeText}
                    onChange={(e) => setComposeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    rows={1}
                    placeholder={pendingImage ? 'Tulis caption (opsional)…' : 'Tulis pesan…'}
                    disabled={!isConnected}
                    className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:focus:bg-gray-800"
                  />
                  <button
                    onClick={handleSend}
                    disabled={
                      (!composeText.trim() && !pendingImage) ||
                      !isConnected ||
                      send.isPending ||
                      sendImage.isPending
                    }
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-gray-300 dark:disabled:bg-gray-700"
                    aria-label="Kirim"
                  >
                    {send.isPending || sendImage.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      )}
      </>
      )}

      {/* QR modal */}
      <Dialog open={showQr} onClose={() => setShowQr(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pindai QR Code</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR Code WhatsApp" className="h-64 w-64" />
            ) : (
              <Loader2 className="h-12 w-12 animate-spin text-gray-400" />
            )}
            <p className="text-center text-sm text-gray-600 dark:text-gray-400">
              Buka WhatsApp → Perangkat Tertaut → Tautkan Perangkat → Pindai QR ini.
            </p>
            <p className="text-center text-xs text-gray-400">
              Status: {STATUS_LABEL[status] ?? status}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Pairing code modal */}
      <Dialog open={showPairCode} onClose={() => setShowPairCode(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hubungkan dengan Kode</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!pairCode ? (
              <>
                <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  Masukkan nomor WhatsApp yang ingin dihubungkan. Cara ini lebih mudah kalau
                  dashboard dibuka dari HP yang sama.
                </p>
                <Input
                  value={pairPhone}
                  onChange={(e) => setPairPhone(e.target.value)}
                  placeholder="08123456789"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePairCodeSubmit()
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowPairCode(false)}>
                    Batal
                  </Button>
                  <Button
                    variant="brand"
                    onClick={handlePairCodeSubmit}
                    loading={pairWithCode.isPending}
                    disabled={!pairPhone.trim()}
                  >
                    <KeyRound className="h-4 w-4" />
                    Tampilkan Kode
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-brand-200 bg-brand-50 p-5 text-center dark:border-brand-800 dark:bg-brand-950/30">
                  <p className="text-xs font-medium uppercase tracking-wide text-brand-700 dark:text-brand-300">
                    Kode WhatsApp
                  </p>
                  <p className="mt-2 font-mono text-3xl font-bold tracking-widest text-gray-900 dark:text-gray-100">
                    {pairCode}
                  </p>
                </div>
                <ol className="space-y-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
                  <li>1. Buka WhatsApp di HP dengan nomor tersebut.</li>
                  <li>2. Masuk ke Perangkat tertaut.</li>
                  <li>3. Ketuk Tautkan perangkat.</li>
                  <li>4. Pilih Tautkan dengan nomor telepon, lalu masukkan kode ini.</li>
                </ol>
                <p className="text-xs text-gray-400">
                  Kode berlaku sebentar. Jika gagal, buat kode baru.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setPairCode(null)}>
                    Buat kode baru
                  </Button>
                  <Button variant="brand" onClick={() => setShowPairCode(false)}>
                    Selesai
                  </Button>
                </div>
              </div>
            )}
            <p className="text-center text-xs text-gray-400">
              Status: {STATUS_LABEL[status] ?? status}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* New chat modal */}
      <Dialog open={showNewChat} onClose={() => setShowNewChat(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Chat Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Masukkan nomor WhatsApp (format Indonesia: 08xx, 62xx, atau +62).
            </p>
            <Input
              value={newJidInput}
              onChange={(e) => setNewJidInput(e.target.value)}
              placeholder="08123456789"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleStartNewChat()
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowNewChat(false)}>
                Batal
              </Button>
              <Button variant="brand" onClick={handleStartNewChat}>
                Mulai
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── AI Settings ───────────────────────────────────────────────────

function AiSettingsPanel({
  instanceId,
  instance,
  tenant,
}: {
  instanceId: string
  instance?: {
    phoneNumber?: string | null
    aiEnabled: boolean
    aiSystemPrompt?: string | null
    aiMaxHistory: number
    aiProviderConfigId?: string | null
    adminPhone?: string | null
    handoffAutoResumeHours?: number | null
    otpLoginEnabled?: boolean
  } | null
  // Used to pre-fill the system prompt template with the operator's
  // own business name + jenis usaha so they don't have to retype.
  tenant?: {
    businessName?: string | null
    businessCategory?: string | null
  } | null
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [aiEnabled, setAiEnabled] = React.useState(instance?.aiEnabled ?? false)
  const [systemPrompt, setSystemPrompt] = React.useState(instance?.aiSystemPrompt ?? '')
  const [maxHistory, setMaxHistory] = React.useState(instance?.aiMaxHistory ?? 10)
  const [adminPhone, setAdminPhone] = React.useState(instance?.adminPhone ?? '')
  const [handoffHours, setHandoffHours] = React.useState(
    instance?.handoffAutoResumeHours ?? 24,
  )
  const [otpLoginEnabled, setOtpLoginEnabled] = React.useState(
    instance?.otpLoginEnabled ?? false,
  )

  React.useEffect(() => {
    if (!instance) return
    setAiEnabled(instance.aiEnabled)
    setSystemPrompt(instance.aiSystemPrompt ?? '')
    setMaxHistory(instance.aiMaxHistory)
    setAdminPhone(instance.adminPhone ?? '')
    setHandoffHours(instance.handoffAutoResumeHours ?? 24)
    setOtpLoginEnabled(instance.otpLoginEnabled ?? false)
  }, [instance])

  // Client-side validation that mirrors the API rules so we surface
  // problems before the round-trip:
  //  - admin phone, when set, must look like a digit-only Indonesian number
  //  - admin phone must NOT match this instance's own paired number
  //  - auto-resume hours must be 0..168
  const adminPhoneError = React.useMemo(() => {
    const trimmed = adminPhone.trim()
    if (!trimmed) return null
    const digits = trimmed.replace(/\D/g, '')
    if (digits.length < 8 || digits.length > 15) {
      return 'Nomor admin harus 8–15 digit.'
    }
    const ownDigits = (instance?.phoneNumber ?? '').replace(/\D/g, '')
    if (ownDigits && digits === ownDigits) {
      return 'Nomor admin tidak boleh sama dengan nomor instance ini.'
    }
    return null
  }, [adminPhone, instance?.phoneNumber])

  const save = useMutation({
    mutationFn: () => {
      if (adminPhoneError) {
        throw new Error(adminPhoneError)
      }
      return updateWaInstance({
        data: {
          id: instanceId,
          aiEnabled,
          aiSystemPrompt: systemPrompt,
          aiMaxHistory: maxHistory,
          aiProviderConfigId: '',
          // Send digits-only when present, empty string when cleared so
          // the server's COALESCE leaves it alone vs. clears it. The
          // backend treats empty string as "leave alone" too — we send
          // undefined to skip the field entirely when blank.
          adminPhone: adminPhone.trim() ? adminPhone.replace(/\D/g, '') : undefined,
          handoffAutoResumeHours: handoffHours,
          otpLoginEnabled,
        },
      })
    },
    onSuccess: () => {
      toast({ title: 'Pengaturan AI disimpan', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['wa-instance', instanceId] })
    },
    onError: (e: Error) =>
      toast({ title: 'Gagal menyimpan', description: e.message, variant: 'error' }),
  })

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 lg:px-0">
      {/* AI config form */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-4 text-sm font-semibold text-gray-900 dark:text-gray-100">
          Konfigurasi Auto-Reply AI
        </h2>

        <div className="space-y-5">
          {/* Toggle */}
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Auto-Reply AI
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Balas pesan masuk secara otomatis menggunakan AI
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={aiEnabled}
              onClick={() => setAiEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 ${
                aiEnabled ? 'bg-brand-600' : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  aiEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </label>

          {/* System prompt */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label
                htmlFor="ai-system-prompt"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                System Prompt
              </label>
              <button
                type="button"
                onClick={() => {
                  // Confirm before overwriting non-empty content so the
                  // operator doesn't lose tuning by accident.
                  if (
                    systemPrompt.trim() &&
                    !window.confirm(
                      'Prompt saat ini akan diganti dengan template default. Lanjutkan?',
                    )
                  ) {
                    return
                  }
                  setSystemPrompt(buildSystemPromptTemplate(tenant))
                }}
                className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline dark:text-brand-400 dark:hover:text-brand-300"
                title="Isi dengan template umum — sesuaikan setelahnya"
              >
                Pakai template
              </button>
            </div>
            <textarea
              id="ai-system-prompt"
              rows={8}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Kamu CS toko kelontong yang ramah, balas singkat dalam Bahasa Indonesia."
              className="w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500"
            />
            <p className="mt-1 text-xs text-gray-400">
              Kosongkan untuk menggunakan prompt default, atau klik{' '}
              <span className="font-medium">Pakai template</span> untuk
              mengisi dengan contoh yang bisa disesuaikan.
            </p>
          </div>

          {/* Max history */}
          <div>
            <label
              htmlFor="ai-max-history"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Riwayat Pesan untuk Konteks
            </label>
            <input
              id="ai-max-history"
              type="number"
              min={1}
              max={20}
              value={maxHistory}
              onChange={(e) =>
                setMaxHistory(Math.max(1, Math.min(20, parseInt(e.target.value) || 10)))
              }
              className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-400">
              Jumlah pesan sebelumnya yang dibaca AI untuk konteks (1–20).
            </p>
          </div>
        </div>

      </div>

      {/* Handoff to admin (JUR-74) */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
          Handoff ke Admin
        </h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Saat AI mengarahkan pelanggan ke admin (mis. permintaan rumit, komplain),
          notifikasi otomatis dikirim ke nomor admin di bawah ini.
        </p>

        <div className="space-y-5">
          {/* Admin phone */}
          <div>
            <label
              htmlFor="admin-phone"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Nomor WhatsApp Admin
            </label>
            <Input
              id="admin-phone"
              value={adminPhone}
              onChange={(e) => setAdminPhone(e.target.value)}
              placeholder="08123456789"
              inputMode="tel"
              autoComplete="off"
            />
            {adminPhoneError ? (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                {adminPhoneError}
              </p>
            ) : (
              <p className="mt-1 text-xs text-gray-400">
                Format: 08xx, 62xx, atau +62. Kosongkan untuk mematikan notifikasi.
              </p>
            )}
          </div>

          {/* Auto-resume hours */}
          <div>
            <label
              htmlFor="handoff-hours"
              className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              AI Aktif Kembali Otomatis (jam)
            </label>
            <input
              id="handoff-hours"
              type="number"
              min={0}
              max={168}
              value={handoffHours}
              onChange={(e) =>
                setHandoffHours(
                  Math.max(0, Math.min(168, parseInt(e.target.value) || 0)),
                )
              }
              className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/30 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <p className="mt-1 text-xs text-gray-400">
              Setelah berapa jam AI boleh menjawab kontak yang sudah dialihkan ke
              admin (0–168). Set <span className="font-semibold">0</span> untuk
              menonaktifkan auto-resume — admin harus aktifkan manual.
            </p>
          </div>
        </div>

      </div>

      {/* Staff WhatsApp OTP login (PR 6) — per-instance kill switch
          for the login flow. The inbound detector reads this BEFORE
          running the OTP-request regex, so disabled instances pay
          zero runtime cost. Requires tier basic+ at the API level. */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
          Login Karyawan via WhatsApp
        </h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Karyawan toko dapat login dengan mengirim pesan "minta OTP" ke
          instance WhatsApp ini. Sistem akan membalas dengan kode 6
          digit. Aktifkan di halaman <span className="font-medium">Anggota Tim</span> per
          karyawan setelah toggle ini hidup.
        </p>
        <div className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Aktifkan login WhatsApp untuk instance ini
            </p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              Hanya berlaku untuk karyawan yang telah diaktifkan login WA-nya
              di halaman Anggota Tim. Pelanggan biasa tidak terpengaruh.
            </p>
          </div>
          {/* Pill switch — same shape as the RAG tools toggle below for
              visual consistency. Pure-CSS via Tailwind; no headless-ui
              dependency. The hidden span slides on the `translate-x-*`
              transform so the animation matches the RAG row exactly. */}
          <button
            type="button"
            role="switch"
            aria-checked={otpLoginEnabled}
            onClick={() => setOtpLoginEnabled(!otpLoginEnabled)}
            className={cnRag(
              'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
              otpLoginEnabled ? 'bg-brand-600' : 'bg-gray-200 dark:bg-gray-700',
            )}
          >
            <span
              className={cnRag(
                'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
                otpLoginEnabled ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
      </div>

      {/* Single shared save — persists AI config + Handoff + OTP login
          in one PATCH so the user isn't confused by separate buttons. */}
      <div className="flex justify-end">
        <Button
          variant="brand"
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={!!adminPhoneError}
        >
          Simpan Pengaturan
        </Button>
      </div>

      <RagToolsPanel instanceId={instanceId} />
    </div>
  )
}

// ── RAG tools panel (per-instance, tier-locked) ──────────────────

function RagToolsPanel({ instanceId }: { instanceId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: tools = [], isLoading } = useQuery({
    queryKey: ['wa-rag-tools', instanceId],
    queryFn: () => getInstanceRagTools({ data: { instanceId } }),
  })

  const toggle = useMutation({
    mutationFn: (vars: { toolId: string; enabled: boolean }) =>
      updateInstanceRagTool({ data: { instanceId, ...vars } }),
    onMutate: async (vars) => {
      // Optimistic update — flip the local cache immediately for snappy UX.
      await queryClient.cancelQueries({ queryKey: ['wa-rag-tools', instanceId] })
      const prev = queryClient.getQueryData<typeof tools>(['wa-rag-tools', instanceId])
      queryClient.setQueryData<typeof tools>(['wa-rag-tools', instanceId], (old) =>
        old?.map((t) => (t.id === vars.toolId ? { ...t, enabled: vars.enabled } : t)),
      )
      return { prev }
    },
    onError: (e: Error, _vars, ctx) => {
      // Roll back the optimistic write and surface the server error.
      if (ctx?.prev) queryClient.setQueryData(['wa-rag-tools', instanceId], ctx.prev)
      toast({ title: 'Gagal menyimpan', description: e.message, variant: 'error' })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['wa-rag-tools', instanceId] })
    },
  })

  const anyEnabled = tools.some((t) => t.enabled)

  if (isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="h-32 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700/50" />
      </div>
    )
  }

  if (tools.length === 0) {
    // Platform admin hasn't configured any RAG tools yet — hide the section.
    return null
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h2 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
        Konteks AI (RAG)
      </h2>
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        Pilih data toko yang boleh dilihat AI saat membalas pelanggan. Aktifkan satu per satu
        sesuai kebutuhan.
      </p>

      {!anyEnabled && (
        <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:border-brand-800/50 dark:bg-brand-900/20 dark:text-brand-300">
          Aktifkan konteks AI untuk balasan yang lebih akurat — minimal harga + stok.
        </div>
      )}

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {tools.map((tool) => {
          const disabled = tool.locked || toggle.isPending
          return (
            <div
              key={tool.id}
              className={cnRag(
                'flex items-center justify-between gap-3 py-3',
                tool.locked && 'opacity-60',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {tool.name}
                  </span>
                  {tool.locked && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-700 dark:bg-accent-900/30 dark:text-accent-400"
                      title={`Tersedia di paket ${capitalize(tool.minTier)}`}
                    >
                      <Lock className="h-3 w-3" /> {capitalize(tool.minTier)}
                    </span>
                  )}
                </div>
                {tool.description && (
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    {tool.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={tool.enabled}
                disabled={disabled}
                onClick={() => toggle.mutate({ toolId: tool.id, enabled: !tool.enabled })}
                className={cnRag(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:cursor-not-allowed',
                  tool.enabled ? 'bg-brand-600' : 'bg-gray-200 dark:bg-gray-700',
                )}
              >
                <span
                  className={cnRag(
                    'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
                    tool.enabled ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Local className joiner — the file doesn't import a global one and
// adding the import would touch unrelated existing code.
function cnRag(...args: Array<string | false | undefined>): string {
  return args.filter(Boolean).join(' ')
}

// ── Sub-components ────────────────────────────────────────────────

function ContactRow({
  contact,
  selected,
  onClick,
}: {
  contact: Contact
  selected: boolean
  onClick: () => void
}) {
  const name = contactDisplayName(contact)
  const secondaryName = contactSecondaryName(contact)
  const unread = contact.unreadCount > 0
  const needsHuman = !!contact.needsHuman
  return (
    <li>
      <button
        onClick={onClick}
        className={`flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
          selected
            ? 'bg-brand-50 dark:bg-brand-900/20'
            : needsHuman
              ? 'bg-warning-50/40 dark:bg-warning-900/10'
              : ''
        }`}
      >
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p
              className={`truncate text-sm ${
                unread
                  ? 'font-bold text-gray-900 dark:text-white'
                  : 'font-semibold text-gray-900 dark:text-gray-100'
              }`}
            >
              {name}
            </p>
            {contact.lastMessageAt && (
              <span
                className={`shrink-0 text-[11px] ${
                  unread
                    ? 'font-semibold text-brand-600 dark:text-brand-400'
                    : 'text-gray-400'
                }`}
              >
                {formatContactTime(contact.lastMessageAt)}
              </span>
            )}
          </div>
          {secondaryName && (
            <p className="truncate text-[11px] italic text-gray-400 dark:text-gray-500">
              WA: {secondaryName}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p
              className={`truncate text-xs ${
                unread
                  ? 'font-medium text-gray-700 dark:text-gray-200'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {contactPreview(contact)}
            </p>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {needsHuman && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-warning-100 px-1.5 py-0.5 text-[10px] font-semibold text-warning-800 dark:bg-warning-900/30 dark:text-warning-300"
                  title="AI sudah meminta admin untuk membantu kontak ini."
                >
                  <AlertTriangle className="h-3 w-3" />
                  Admin
                </span>
              )}
              {unread && (
                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold leading-none text-white">
                  {contact.unreadCount > 99 ? '99+' : contact.unreadCount}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>
    </li>
  )
}

// JUR-74 — per-contact handoff toggle pinned to the conversation
// header. Always visible so admin can pause AI before it does
// something dumb (e.g., during an active negotiation that AI shouldn't
// interfere with), not just react after AI itself triggered handoff.
//
// State machine:
//   aiEnabled=false (instance-wide)  → "Auto-Reply Off" pill → click navigates
//                                       to settings (toggle is OFF in DB).
//   aiEnabled=true + needsHuman=false → "Jeda AI"      → POST {enabled: true}
//   aiEnabled=true + needsHuman=true  → "Aktifkan AI"  → POST {enabled: false}
//
// The instance-wide off state is rendered as a non-mutation button to
// avoid the misleading "Jeda AI" label when there's nothing running.
function HandoffToggleButton({
  instanceId,
  contact,
  aiEnabled,
  onOpenSettings,
}: {
  instanceId: string
  contact: Contact
  aiEnabled: boolean
  onOpenSettings: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const isHandoff = !!contact.needsHuman

  // Instance-wide AI is OFF — the per-contact toggle would be a lie.
  // Render an informational pill that takes the user to Pengaturan AI
  // where they can enable it. No mutation runs.
  if (!aiEnabled) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={onOpenSettings}
        title="Auto-Reply AI saat ini nonaktif untuk instance ini. Klik untuk buka Pengaturan AI."
      >
        <PauseCircle className="h-4 w-4 text-gray-400" />
        <span className="hidden text-gray-500 sm:inline dark:text-gray-400">
          Auto-Reply Off
        </span>
      </Button>
    )
  }

  const m = useMutation({
    mutationFn: () =>
      updateContactHandoff({
        data: {
          instanceId,
          remoteJid: contact.remoteJid,
          enabled: !isHandoff,
          reason: !isHandoff ? 'Dijeda manual oleh admin' : undefined,
        },
      }),
    // Optimistic flip — the button label changes immediately, so the
    // user gets feedback even before the 5s contact-list refetch lands.
    // Rolled back in onError if the API call fails.
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['wa-contacts', instanceId] })
      const prev = queryClient.getQueryData<Contact[]>(['wa-contacts', instanceId])
      const next = !isHandoff
      queryClient.setQueryData<Contact[]>(['wa-contacts', instanceId], (old) =>
        old?.map((c) =>
          c.remoteJid === contact.remoteJid
            ? {
                ...c,
                needsHuman: next,
                handoffAt: next ? new Date().toISOString() : null,
                handoffReason: next ? 'Dijeda manual oleh admin' : null,
                handoffSummary: next ? null : null,
              }
            : c,
        ),
      )
      return { prev }
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['wa-contacts', instanceId], ctx.prev)
      }
      toast({
        title: 'Gagal mengubah status AI',
        description: e.message,
        variant: 'error',
      })
    },
    onSuccess: () => {
      toast({
        title: isHandoff ? 'AI aktif kembali' : 'AI dijeda untuk kontak ini',
        variant: 'success',
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['wa-contacts', instanceId] })
    },
  })

  return (
    <Button
      variant={isHandoff ? 'brand' : 'ghost'}
      size="sm"
      loading={m.isPending}
      onClick={() => m.mutate()}
      title={
        isHandoff
          ? 'AI saat ini berhenti membalas kontak ini. Klik untuk mengaktifkan kembali.'
          : 'Hentikan auto-reply AI khusus kontak ini. Berguna saat admin mau ambil alih percakapan.'
      }
    >
      {isHandoff ? (
        <>
          <UserCheck className="h-4 w-4" />
          <span className="hidden sm:inline">Aktifkan AI</span>
        </>
      ) : (
        <>
          <PauseCircle className="h-4 w-4" />
          <span className="hidden sm:inline">Jeda AI</span>
        </>
      )}
    </Button>
  )
}

// JUR-74 — banner shown above the messages scroll area when a contact
// has been flagged for admin follow-up. Surfaces the AI's reason +
// summary, the countdown until auto-resume, and a one-click button to
// hand control back to the AI immediately.
function HandoffBanner({
  instanceId,
  contact,
  autoResumeHours,
  onResumed,
}: {
  instanceId: string
  contact: Contact
  autoResumeHours: number
  onResumed: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const resume = useMutation({
    mutationFn: () =>
      updateContactHandoff({
        data: { instanceId, remoteJid: contact.remoteJid, enabled: false },
      }),
    onSuccess: () => {
      toast({ title: 'AI aktif kembali', variant: 'success' })
      queryClient.invalidateQueries({ queryKey: ['wa-contacts', instanceId] })
      onResumed()
    },
    onError: (e: Error) =>
      toast({
        title: 'Gagal mengaktifkan AI',
        description: e.message,
        variant: 'error',
      }),
  })

  const countdown = handoffCountdown(contact.handoffAt, autoResumeHours)

  return (
    <div className="border-b border-warning-200 bg-warning-50 px-4 py-3 dark:border-warning-900/40 dark:bg-warning-900/20">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-300">
          <UserCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-warning-900 dark:text-warning-200">
            AI menunggu admin untuk membantu
          </p>
          {contact.handoffReason && (
            <p className="mt-0.5 text-xs text-warning-800 dark:text-warning-300">
              <span className="font-medium">Pesan terakhir pelanggan:</span>{' '}
              {contact.handoffReason}
            </p>
          )}
          {contact.handoffSummary && (
            <p className="mt-1 text-xs text-warning-800/90 dark:text-warning-300/90">
              <span className="font-medium">Catatan AI:</span>{' '}
              {contact.handoffSummary}
            </p>
          )}
          <p className="mt-1.5 text-[11px] text-warning-700/80 dark:text-warning-300/70">
            {countdown
              ? `AI otomatis aktif kembali dalam ${countdown} jika tidak diaktifkan manual.`
              : 'AI tidak akan otomatis aktif — aktifkan manual saat selesai.'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          loading={resume.isPending}
          onClick={() => resume.mutate()}
          className="shrink-0"
        >
          Aktifkan kembali AI
        </Button>
      </div>
    </div>
  )
}

// Returns a humanised "X jam Y menit" string until handoff auto-resume,
// or null when the timer has expired (the next inbound message will
// trigger the worker to clear the flag) or when no auto-resume is set
// (autoResumeHours === 0).
function handoffCountdown(
  handoffAt: string | null | undefined,
  autoResumeHours: number,
): string | null {
  if (!handoffAt || autoResumeHours <= 0) return null
  const start = new Date(handoffAt).getTime()
  if (Number.isNaN(start)) return null
  const expiresAt = start + autoResumeHours * 60 * 60 * 1000
  const remainingMs = expiresAt - Date.now()
  if (remainingMs <= 0) return null
  const totalMin = Math.floor(remainingMs / 60_000)
  const hours = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  if (hours === 0) return `${mins} menit`
  if (mins === 0) return `${hours} jam`
  return `${hours} jam ${mins} menit`
}

function Avatar({ name }: { name: string }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
      {initial}
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const mine = msg.fromMe

  // Sticker is rendered chrome-free — no bubble background, no border.
  // The bubble shell only adds noise around what is essentially a tiny
  // floating image.
  if (msg.type === 'sticker' && msg.mediaKey) {
    return (
      <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
        <div className="max-w-[140px]">
          <MediaImage messageId={msg.id} alt="Stiker" maxSize={120} sticker />
          <div
            className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
              mine ? 'text-brand-200' : 'text-gray-400'
            }`}
          >
            <span>{formatTime(msg.createdAt)}</span>
            {mine && <MessageStatusIcon status={msg.status} />}
          </div>
        </div>
        <ReactionPills reactions={msg.reactions} mine={mine} />
      </li>
    )
  }

  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[60%] ${
          mine
            ? 'rounded-br-md bg-brand-600 text-white'
            : 'rounded-bl-md bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100'
        }`}
      >
        {/* Media body (image or document) above the caption text */}
        {msg.type === 'image' && msg.mediaKey && (
          <MediaImage messageId={msg.id} alt={msg.body ?? 'Gambar'} maxSize={240} />
        )}
        {msg.type === 'document' && msg.mediaKey && (
          <MediaDocument
            messageId={msg.id}
            sizeBytes={msg.mediaSizeBytes ?? null}
            mine={mine}
          />
        )}
        {/* Caption / text body */}
        {msg.body ? (
          <p
            className={`whitespace-pre-wrap break-words ${
              (msg.type === 'image' || msg.type === 'document') && msg.mediaKey
                ? 'mt-1.5'
                : ''
            }`}
          >
            {msg.body}
          </p>
        ) : !msg.mediaKey && msg.type !== 'text' ? (
          <p className="italic opacity-70">
            [
            {msg.type === 'image'
              ? 'Gambar (gagal diunduh)'
              : msg.type === 'sticker'
                ? 'Stiker (gagal diunduh)'
                : msg.type === 'document'
                  ? 'Dokumen (gagal diunduh)'
                  : msg.type === 'audio'
                    ? 'Pesan suara'
                    : msg.type === 'video'
                      ? 'Video'
                      : msg.type === 'other'
                        ? 'Pesan tidak didukung'
                        : msg.type}
            ]
          </p>
        ) : null}
        <div
          className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${
            mine ? 'text-brand-100' : 'text-gray-400'
          }`}
        >
          <span>{formatTime(msg.createdAt)}</span>
          {mine && <MessageStatusIcon status={msg.status} />}
        </div>
        {msg.errorMessage && (
          <p className="mt-1 text-[10px] text-red-200">{msg.errorMessage}</p>
        )}
      </div>
      <ReactionPills reactions={msg.reactions} mine={mine} />
    </li>
  )
}

// JUR-80: emoji-reaction pills rendered just below a bubble, on the
// same side. Identical emojis are grouped into one pill with a count
// so multiple senders reacting 👍 don't take three pill-widths of
// horizontal space. Negative top margin pulls the pill to overlap
// the bubble's bottom edge slightly — matches WhatsApp's own UI.
function ReactionPills({
  reactions,
  mine,
}: {
  reactions: Message['reactions']
  mine: boolean
}) {
  if (!reactions || reactions.length === 0) return null
  const groups = new Map<string, number>()
  for (const r of reactions) {
    groups.set(r.emoji, (groups.get(r.emoji) ?? 0) + 1)
  }
  return (
    <div
      className={`-mt-1 flex gap-1 ${mine ? 'mr-2' : 'ml-2'}`}
      aria-label="Reaksi pesan"
    >
      {[...groups].map(([emoji, count]) => (
        <span
          key={emoji}
          className="inline-flex items-center gap-0.5 rounded-full bg-white px-1.5 py-0.5 text-xs shadow-sm ring-1 ring-gray-200 dark:bg-gray-700 dark:ring-gray-600"
        >
          <span aria-hidden="true">{emoji}</span>
          {count > 1 && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {count}
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

// JUR-77 — image rendered from a signed S3 URL. Fetched lazily on
// mount, cached by React Query for 4 minutes (signed URL TTL is 5
// min, leaving 1 min headroom). Click → lightbox at full resolution.
//
// Three states: loading shimmer, loaded image, fallback message
// when the S3 fetch returned 404 (3-day lifecycle elapsed).
function MediaImage({
  messageId,
  alt,
  maxSize,
  sticker = false,
}: {
  messageId: string
  alt: string
  maxSize: number
  sticker?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['wa-media', messageId],
    queryFn: () => getWaMediaUrl({ data: { messageId } }),
    staleTime: 4 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-gray-200 dark:bg-gray-700 ${
          sticker ? '' : ''
        }`}
        style={{ width: maxSize, height: maxSize }}
      >
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    )
  }
  if (!data?.url) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 rounded-lg bg-gray-100 px-3 text-center text-[11px] text-gray-500 dark:bg-gray-700/60 dark:text-gray-400`}
        style={{ width: maxSize, height: maxSize }}
      >
        <ImageIcon className="h-5 w-5 opacity-50" />
        <span>Media tidak tersedia</span>
      </div>
    )
  }
  return (
    <>
      <img
        src={data.url}
        alt={alt}
        loading="lazy"
        onClick={() => setOpen(true)}
        className={`cursor-zoom-in rounded-lg object-cover ${
          sticker ? '' : 'shadow-sm'
        }`}
        style={{ maxWidth: maxSize, maxHeight: maxSize }}
      />
      {open && (
        <Dialog open={open} onClose={() => setOpen(false)}>
          <DialogContent>
            <div className="flex max-h-[80vh] items-center justify-center">
              <img
                src={data.url}
                alt={alt}
                className="max-h-[80vh] max-w-full rounded-lg object-contain"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// JUR-77 — document bubble. Click → opens signed URL in a new tab so
// the browser handles inline preview / download per the file MIME.
function MediaDocument({
  messageId,
  sizeBytes,
  mine,
}: {
  messageId: string
  sizeBytes: number | null
  mine: boolean
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['wa-media', messageId],
    queryFn: () => getWaMediaUrl({ data: { messageId } }),
    staleTime: 4 * 60 * 1000,
  })

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLoading || !data?.url}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
        mine
          ? 'bg-brand-700/30 hover:bg-brand-700/50 disabled:hover:bg-brand-700/30'
          : 'bg-gray-100 hover:bg-gray-200 disabled:hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-700/80'
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <FileText className={`h-5 w-5 shrink-0 ${mine ? 'text-brand-100' : 'text-gray-500 dark:text-gray-300'}`} />
      <div className="min-w-0 flex-1">
        <p className={`truncate font-medium ${mine ? 'text-white' : 'text-gray-900 dark:text-gray-100'}`}>
          Dokumen
        </p>
        {sizeBytes != null && (
          <p className={mine ? 'text-brand-100/80' : 'text-gray-500 dark:text-gray-400'}>
            {formatBytes(sizeBytes)}
          </p>
        )}
        {!data?.url && !isLoading && (
          <p className={mine ? 'text-brand-100/80' : 'text-gray-500 dark:text-gray-400'}>
            Tidak tersedia
          </p>
        )}
      </div>
    </button>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MessageStatusIcon({ status }: { status: string }) {
  if (status === 'failed') return <AlertCircle className="h-3 w-3 text-red-200" />
  if (status === 'pending') return <Clock className="h-3 w-3" />
  if (status === 'sent') return <Check className="h-3 w-3" />
  if (status === 'delivered' || status === 'read')
    return <CheckCheck className="h-3 w-3" />
  return null
}

function EmptyContactList({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-12 text-center">
      <MessageCircle className="mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {hasSearch ? 'Kontak tidak ditemukan' : 'Belum ada percakapan'}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {hasSearch
          ? 'Coba kata kunci lain.'
          : 'Mulai chat baru atau tunggu pesan masuk.'}
      </p>
    </div>
  )
}

/**
 * Full-area gate shown until the instance reaches status='connected'.
 * Walks the user through pairing without revealing the chat UI early.
 *
 * Status-aware copy + button label so the screen reflects current state:
 *   - disconnected         → "Pindai QR untuk menghubungkan"
 *   - connecting / qr      → "Menunggu pairing dari ponsel…" (pending)
 *   - logged_out / banned  → terminal copy, retry button still visible
 */
function NotPairedGate({
  status,
  onConnect,
  onUseCode,
  connecting,
  pairingCode,
}: {
  status: string
  onConnect: () => void
  onUseCode: () => void
  connecting: boolean
  pairingCode: boolean
}) {
  const terminal = status === 'logged_out' || status === 'banned'
  const inProgress = status === 'connecting' || status === 'qr'

  let title = 'Hubungkan WhatsApp'
  let description =
    'Hubungkan nomor WhatsApp dengan QR atau kode. Gunakan kode jika Anda membuka dashboard ini dari HP yang sama.'
  let buttonLabel = 'Pindai QR'

  if (terminal) {
    title = status === 'logged_out' ? 'WhatsApp keluar dari sesi' : 'Akun diblokir WhatsApp'
    description =
      status === 'logged_out'
        ? 'Sesi WhatsApp dihentikan dari ponsel. Hubungkan ulang dengan QR atau kode untuk melanjutkan.'
        : 'Akun ini diblokir oleh WhatsApp. Buat instance baru dengan nomor lain.'
    buttonLabel = 'Pindai QR ulang'
  } else if (inProgress) {
    title = 'Menunggu pairing'
    description =
      status === 'qr'
        ? 'QR atau kode sedang menunggu konfirmasi dari ponsel.'
        : 'Menyambungkan ke server WhatsApp…'
    buttonLabel = 'Buka QR'
  }

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-100 dark:bg-brand-900/30">
          {inProgress ? (
            <Loader2 className="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" />
          ) : (
            <QrCode className="h-8 w-8 text-brand-600 dark:text-brand-400" />
          )}
        </div>
        <h2 className="mt-5 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {description}
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Button
            variant="brand"
            className="w-full"
            onClick={onConnect}
            loading={connecting}
            disabled={connecting || pairingCode}
          >
            <QrCode className="h-4 w-4" />
            {buttonLabel}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={onUseCode}
            disabled={connecting || pairingCode}
          >
            <KeyRound className="h-4 w-4" />
            Gunakan Kode
          </Button>
        </div>
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-left dark:bg-gray-900/60">
          <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Kode cocok untuk pengguna yang membuka Vintra dari HP, jadi tidak perlu
            memindai layar sendiri.
          </p>
        </div>
        <p className="mt-4 text-xs text-gray-400">
          Status: {STATUS_LABEL[status] ?? status}
        </p>
      </div>
    </div>
  )
}

function EmptyConversation() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="rounded-full bg-brand-100 p-6 dark:bg-brand-900/30">
        <MessageCircle className="h-12 w-12 text-brand-600 dark:text-brand-400" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
        Vintra WhatsApp
      </h3>
      <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
        Pilih kontak di kiri untuk membuka percakapan, atau mulai chat baru.
      </p>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────

function contactDisplayName(c: Contact | null): string {
  if (!c) return ''
  // Master customer name (if linked) wins. Falls back to whatever the
  // contact set on their own phone (push_name) or the saved per-contact
  // override (name), then to a formatted phone.
  return (
    c.masterCustomerName ||
    c.pushName ||
    c.name ||
    formatJidAsPhone(c.remoteJid) ||
    c.remoteJid
  )
}

// Secondary label shown under the primary name when the operator has
// the contact saved in master data AND the contact's WhatsApp profile
// name differs from the saved name. Returns null otherwise (no second
// line, primary name stands alone).
function contactSecondaryName(c: Contact | null): string | null {
  if (!c || !c.masterCustomerName) return null
  const wa = c.pushName || c.name
  if (!wa) return null
  if (wa.trim().toLowerCase() === c.masterCustomerName.trim().toLowerCase()) return null
  return wa
}

function hasRealName(c: Contact | null): boolean {
  return !!(c && (c.masterCustomerName || c.pushName || c.name))
}

/**
 * Subtitle line under the contact's name in the conversation header.
 * Three states:
 *   1. JID is a real phone → format as +62 xxx-xxxx-xxxx and show plainly
 *   2. JID is an opaque LID-style ID + we have a name → show a lock icon
 *      with "Nomor disembunyikan WhatsApp" (privacy mode explanation)
 *   3. JID is opaque + no name → render nothing (the JID is already the
 *      primary line, no need to repeat).
 */
function ContactSubtitle({ jid, hasName }: { jid: string; hasName: boolean }) {
  const phone = formatJidAsPhone(jid)
  if (phone) {
    return (
      <p className="truncate text-xs text-gray-500 dark:text-gray-400">{phone}</p>
    )
  }
  if (!hasName) return null
  return (
    <p
      className="flex items-center gap-1 truncate text-xs text-gray-500 dark:text-gray-400"
      title="WhatsApp menyembunyikan nomor pengguna saat mereka tidak ada di kontak Anda."
    >
      <Lock className="h-3 w-3 shrink-0" />
      <span className="truncate">Nomor disembunyikan WhatsApp</span>
    </p>
  )
}

/**
 * Format a WhatsApp JID for display as a phone number.
 *
 * Returns an empty string for IDs that don't look like a real phone:
 *   - WhatsApp LIDs (`@lid` suffix) — opaque privacy identifiers
 *   - Numbers outside the typical phone-number length range (8–15 digits)
 *
 * That way the conversation header / contact row can fall back to the
 * push_name alone instead of plastering a meaningless 15-digit string.
 */
function formatJidAsPhone(jid: string): string {
  if (!jid) return ''
  const [num, suffix] = jid.split('@')
  if (!num) return ''
  if (suffix === 'lid') return '' // privacy-mode identifier, not a phone
  if (!/^\d+$/.test(num)) return ''
  if (num.length < 8 || num.length > 15) return '' // out of E.164 range

  if (num.startsWith('62') && num.length >= 11 && num.length <= 14) {
    // 6281234567890 → +62 812-3456-7890
    return '+62 ' + num.slice(2).replace(/(\d{3,4})(?=\d)/g, '$1-')
  }
  return '+' + num
}

function contactPreview(c: Contact): string {
  if (c.lastBody) {
    const prefix = c.lastFromMe ? 'Anda: ' : ''
    return prefix + c.lastBody
  }
  if (c.lastType && c.lastType !== 'text') {
    const icons: Record<string, string> = {
      image: 'Gambar',
      video: 'Video',
      audio: 'Audio',
      document: 'Dokumen',
      sticker: 'Stiker',
      other: 'Pesan',
    }
    return (c.lastFromMe ? 'Anda: ' : '') + (icons[c.lastType] ?? 'Pesan')
  }
  return 'Belum ada pesan'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatContactTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (isToday) return formatTime(iso)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  if (isYesterday) return 'Kemarin'
  return formatDate(d, 'dd/MM')
}

function formatDateGroup(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (isToday) return 'Hari ini'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  if (isYesterday) return 'Kemarin'
  return formatDate(d, 'dd MMMM yyyy')
}

function isSameDay(aIso: string, bIso: string): boolean {
  const a = new Date(aIso)
  const b = new Date(bIso)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
