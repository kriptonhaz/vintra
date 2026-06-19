import * as React from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Stamp, Trash2, X as XIcon, ImagePlus } from 'lucide-react'
import { getPOSSettings, updatePOSSettings } from '@/server/functions/pos'
import {
  listStampPrograms,
  getStampFormMasters,
  createStampProgram,
  updateStampProgram,
  deleteStampProgram,
  getStampActivity,
} from '@/server/functions/loyalty-stamps'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import {
  StampCardEditor,
  type StampCardLayout,
} from '@/components/loyalty/stamp-card-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Combobox } from '@/components/ui/combobox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { posTierLimits } from '@vintra/shared'
import { cn } from '@/lib/utils'
import { formatNumberId } from '@/lib/currency'

export const Route = createFileRoute('/_authed/pos/loyalty')({
  loader: () => getPOSSettings(),
  component: POSLoyaltyPage,
})

function POSLoyaltyPage() {
  const data = Route.useLoaderData()
  const limits = posTierLimits(data.tier)
  const loyaltyAvailable = limits.features.includes('loyalty_points')

  if (!loyaltyAvailable) {
    return (
      <div className="space-y-6">
        <ModuleBreadcrumb />
        <div className="rounded-xl border border-warning-200 bg-warning-50 p-6 text-sm text-warning-900">
          Program loyalty (poin & kartu stempel) tersedia di paket
          Komplit. Upgrade dari halaman billing untuk mengaktifkan.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Loyalty
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Atur program poin dan kartu stempel untuk pelanggan setia.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <LoyaltyPointsSection settings={data.settings} />
        <StampProgramsSection />
      </div>

      <StampActivitySection />
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      {children}
    </div>
  )
}

/**
 * Loyalty points config. Self-contained — own state + own Save button
 * calling updatePOSSettings with just the loyalty columns (every field
 * on that endpoint is optional).
 */
function LoyaltyPointsSection({
  settings,
}: {
  settings: Awaited<ReturnType<typeof getPOSSettings>>['settings']
}) {
  const router = useRouter()
  const { toast } = useToast()

  const [loyaltyEnabled, setLoyaltyEnabled] = React.useState(
    settings?.loyaltyEnabled ?? false,
  )
  const [loyaltyEarnMode, setLoyaltyEarnMode] = React.useState<
    'linear' | 'per_step'
  >((settings?.loyaltyEarnMode as 'linear' | 'per_step' | undefined) ?? 'linear')
  const [loyaltyEarnRate, setLoyaltyEarnRate] = React.useState(
    Number(settings?.loyaltyEarnRate ?? 0.001),
  )
  const [loyaltyEarnStepAmount, setLoyaltyEarnStepAmount] = React.useState(
    Number(settings?.loyaltyEarnStepAmount ?? 0),
  )
  const [loyaltyEarnStepPoints, setLoyaltyEarnStepPoints] = React.useState(
    Number(settings?.loyaltyEarnStepPoints ?? 0),
  )
  const [loyaltyRedeemRate, setLoyaltyRedeemRate] = React.useState(
    Number(settings?.loyaltyRedeemRate ?? 10),
  )

  const save = useMutation({
    mutationFn: () =>
      updatePOSSettings({
        data: {
          loyaltyEnabled,
          loyaltyEarnMode,
          loyaltyEarnRate,
          loyaltyEarnStepAmount,
          loyaltyEarnStepPoints,
          loyaltyRedeemRate,
        },
      }),
    onSuccess: () => {
      toast({ title: 'Loyalty poin disimpan', variant: 'success' })
      router.invalidate()
    },
    onError: (err: Error) => {
      toast({
        title: 'Gagal menyimpan',
        description: err.message,
        variant: 'error',
      })
    },
  })

  return (
    <Section title="Loyalty Poin">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Pelanggan dapat poin dari setiap transaksi dan bisa menukar poin
        sebagai diskon di pembelian berikutnya.
      </p>
      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={loyaltyEnabled}
          onChange={(e) => setLoyaltyEnabled(e.target.checked)}
          className="rounded border-gray-300"
        />
        <span className="text-sm">Aktifkan loyalty poin</span>
      </label>

      <div className="mt-4">
        <p className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">
          Cara hitung poin
        </p>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          <button
            type="button"
            onClick={() => setLoyaltyEarnMode('linear')}
            disabled={!loyaltyEnabled}
            className={cn(
              'rounded-md py-1.5 text-xs font-medium transition-colors',
              loyaltyEarnMode === 'linear'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700',
              !loyaltyEnabled && 'opacity-50',
            )}
          >
            Linear
          </button>
          <button
            type="button"
            onClick={() => setLoyaltyEarnMode('per_step')}
            disabled={!loyaltyEnabled}
            className={cn(
              'rounded-md py-1.5 text-xs font-medium transition-colors',
              loyaltyEarnMode === 'per_step'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700',
              !loyaltyEnabled && 'opacity-50',
            )}
          >
            Per kelipatan
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          {loyaltyEarnMode === 'linear'
            ? 'Poin proporsional setiap rupiah belanja.'
            : 'Poin tetap setiap kelipatan minimal belanja (contoh: 750 poin per kelipatan Rp 15.000).'}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {loyaltyEarnMode === 'linear' ? (
          <div>
            <Input
              label="Earn rate"
              type="number"
              step="0.0001"
              min={0}
              value={loyaltyEarnRate || ''}
              onChange={(e) =>
                setLoyaltyEarnRate(parseFloat(e.target.value) || 0)
              }
              disabled={!loyaltyEnabled}
            />
            <p className="mt-1 text-xs text-gray-500">
              Poin per Rp belanja. Contoh: 0,001 → 1 poin per Rp 1.000.
            </p>
          </div>
        ) : (
          <>
            <div>
              <Input
                label="Per belanja Rp"
                type="number"
                step="100"
                min={0}
                value={loyaltyEarnStepAmount || ''}
                onChange={(e) =>
                  setLoyaltyEarnStepAmount(parseFloat(e.target.value) || 0)
                }
                disabled={!loyaltyEnabled}
              />
              <p className="mt-1 text-xs text-gray-500">
                Minimal belanja per kelipatan (cth. 15.000).
              </p>
            </div>
            <div>
              <Input
                label="Dapat poin"
                type="number"
                step="1"
                min={0}
                value={loyaltyEarnStepPoints || ''}
                onChange={(e) =>
                  setLoyaltyEarnStepPoints(parseFloat(e.target.value) || 0)
                }
                disabled={!loyaltyEnabled}
              />
              <p className="mt-1 text-xs text-gray-500">
                Poin per kelipatan (cth. 750).
              </p>
            </div>
          </>
        )}
        <div className={loyaltyEarnMode === 'per_step' ? 'col-span-2' : ''}>
          <Input
            label="Redeem rate"
            type="number"
            step="1"
            min={0}
            value={loyaltyRedeemRate || ''}
            onChange={(e) =>
              setLoyaltyRedeemRate(parseFloat(e.target.value) || 0)
            }
            disabled={!loyaltyEnabled}
          />
          <p className="mt-1 text-xs text-gray-500">
            Rp per poin. Contoh: 10 → 1 poin = Rp 10.
          </p>
        </div>
      </div>

      {loyaltyEnabled && loyaltyRedeemRate > 0 && (
        <LoyaltyEarnPreview
          mode={loyaltyEarnMode}
          rate={loyaltyEarnRate}
          stepAmount={loyaltyEarnStepAmount}
          stepPoints={loyaltyEarnStepPoints}
          redeemRate={loyaltyRedeemRate}
        />
      )}

      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          variant="brand"
          onClick={() => save.mutate()}
          loading={save.isPending}
        >
          Simpan
        </Button>
      </div>
    </Section>
  )
}

function LoyaltyEarnPreview({
  mode,
  rate,
  stepAmount,
  stepPoints,
  redeemRate,
}: {
  mode: 'linear' | 'per_step'
  rate: number
  stepAmount: number
  stepPoints: number
  redeemRate: number
}) {
  const sampleSpend =
    mode === 'per_step' && stepAmount > 0 ? stepAmount * 2 : 100_000
  let earned = 0
  let stepCount = 0
  if (mode === 'per_step') {
    if (stepAmount > 0 && stepPoints > 0) {
      stepCount = Math.floor(sampleSpend / stepAmount)
      earned = stepCount * stepPoints
    }
  } else if (rate > 0) {
    earned = Math.floor(sampleSpend * rate)
  }

  if (earned === 0 && mode === 'linear' && rate <= 0) return null
  if (
    earned === 0 &&
    mode === 'per_step' &&
    (stepAmount <= 0 || stepPoints <= 0)
  )
    return null

  return (
    <p className="mt-3 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-800 dark:bg-brand-900/20 dark:text-brand-300">
      Pratinjau: belanja Rp {formatNumberId(sampleSpend)} →{' '}
      <strong>{formatNumberId(earned)} poin</strong>
      {mode === 'per_step' && stepCount > 0 && <> ({stepCount} kelipatan)</>}.
      100 poin = Rp {formatNumberId(100 * redeemRate)}.
    </p>
  )
}

/**
 * JUR-195 — stamp / punch-card program manager. Self-contained
 * (own data load + mutations). A program tracks one product category;
 * the cashier stamps a customer's card on every qualifying purchase
 * and the card pays out the configured reward item for free.
 */
function StampProgramsSection() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const programs = useQuery({
    queryKey: ['pos', 'stamp-programs'],
    queryFn: () => listStampPrograms(),
  })
  const masters = useQuery({
    queryKey: ['pos', 'stamp-form-masters'],
    queryFn: () => getStampFormMasters(),
  })

  // null = closed; 'new' = creating; otherwise the program id editing.
  const [editing, setEditing] = React.useState<string | 'new' | null>(null)
  const [name, setName] = React.useState('')
  const [scopeKind, setScopeKind] = React.useState<
    'category' | 'product' | 'product_set'
  >('category')
  const [categoryId, setCategoryId] = React.useState('')
  const [productId, setProductId] = React.useState('')
  const [itemIds, setItemIds] = React.useState<string[]>([])
  const [stampsRequired, setStampsRequired] = React.useState('5')
  const [rewardMode, setRewardMode] = React.useState<'single' | 'bundle'>(
    'single',
  )
  const [rewardItemId, setRewardItemId] = React.useState('')
  const [bundleItems, setBundleItems] = React.useState<
    Array<{ itemId: string; quantity: string }>
  >([])
  const [isActive, setIsActive] = React.useState(true)
  // Image upload state. `existingImageUrl` is the presigned URL we
  // received in the list payload — shown until the user picks a new
  // file or removes it. `imageDataUrl` is the base64 of a freshly
  // picked file; sent inline to the server on save.
  const [imageDataUrl, setImageDataUrl] = React.useState<string | null>(null)
  const [existingImageUrl, setExistingImageUrl] = React.useState<string | null>(
    null,
  )
  const [removeImage, setRemoveImage] = React.useState(false)

  // Digital stamp-card editor state. `*DataUrl` = freshly picked file;
  // `existing*Url` = presigned preview from the list payload. `cardDirty`
  // gates whether we send card fields on save (avoids needless re-renders
  // when the merchant only edited, say, the active flag).
  const [cardDesignDataUrl, setCardDesignDataUrl] = React.useState<
    string | null
  >(null)
  const [cardMarkDataUrl, setCardMarkDataUrl] = React.useState<string | null>(
    null,
  )
  const [existingCardDesignUrl, setExistingCardDesignUrl] = React.useState<
    string | null
  >(null)
  const [existingMarkUrl, setExistingMarkUrl] = React.useState<string | null>(
    null,
  )
  const [cardLayout, setCardLayout] = React.useState<StampCardLayout | null>(
    null,
  )
  const [removeCard, setRemoveCard] = React.useState(false)
  const [cardRenderStatus, setCardRenderStatus] = React.useState<string | null>(
    null,
  )
  const [cardDirty, setCardDirty] = React.useState(false)

  // Client-side pagination kicks in once the list outgrows a single
  // screen. 10/page is enough that single-tenant common cases (2–4
  // programs for Usama-style washes) never see a pager at all.
  const PAGE_SIZE = 10
  const [page, setPage] = React.useState(0)

  function openCreate() {
    setEditing('new')
    setName('')
    setScopeKind('category')
    setCategoryId('')
    setProductId('')
    setItemIds([])
    setStampsRequired('5')
    setRewardMode('single')
    setRewardItemId('')
    setBundleItems([])
    setIsActive(true)
    setImageDataUrl(null)
    setExistingImageUrl(null)
    setRemoveImage(false)
    setCardDesignDataUrl(null)
    setCardMarkDataUrl(null)
    setExistingCardDesignUrl(null)
    setExistingMarkUrl(null)
    setCardLayout(null)
    setRemoveCard(false)
    setCardRenderStatus(null)
    setCardDirty(false)
  }
  function openEdit(p: NonNullable<typeof programs.data>[number]) {
    setEditing(p.id)
    setName(p.name)
    const kind =
      (p.scope as 'category' | 'product' | 'product_set' | null) ??
      (p.productId ? 'product' : 'category')
    setScopeKind(kind)
    setCategoryId(p.categoryId ?? '')
    setProductId(p.productId ?? '')
    setItemIds(p.scopeItems?.map((s) => s.itemId) ?? [])
    setStampsRequired(String(p.stampsRequired))
    const mode = (p.rewardMode as 'single' | 'bundle' | null) ?? 'single'
    setRewardMode(mode)
    setRewardItemId(p.rewardItemId ?? '')
    setBundleItems(
      (p.bundleRewards ?? []).map((b) => ({
        itemId: b.itemId,
        quantity: String(b.quantity),
      })),
    )
    setIsActive(p.isActive)
    setImageDataUrl(null)
    setExistingImageUrl(p.imageUrl ?? null)
    setRemoveImage(false)
    setCardDesignDataUrl(null)
    setCardMarkDataUrl(null)
    setExistingCardDesignUrl(p.cardDesignUrl ?? null)
    setExistingMarkUrl(p.stampMarkUrl ?? null)
    setCardLayout((p.cardLayout as StampCardLayout | null) ?? null)
    setRemoveCard(false)
    setCardRenderStatus(p.cardRenderStatus ?? null)
    setCardDirty(false)
  }

  // Read a picked image file into a base64 data URL.
  function readFileDataUrl(file: File, cb: (dataUrl: string) => void) {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') cb(reader.result)
    }
    reader.readAsDataURL(file)
  }
  function handleCardDesignPick(file: File) {
    readFileDataUrl(file, (url) => {
      setCardDesignDataUrl(url)
      setRemoveCard(false)
      setCardDirty(true)
    })
  }
  function handleCardMarkPick(file: File) {
    readFileDataUrl(file, (url) => {
      setCardMarkDataUrl(url)
      setRemoveCard(false)
      setCardDirty(true)
    })
  }
  function handleCardRemove() {
    setCardDesignDataUrl(null)
    setCardMarkDataUrl(null)
    setExistingCardDesignUrl(null)
    setExistingMarkUrl(null)
    setCardLayout(null)
    setRemoveCard(!!existingCardDesignUrl)
    setCardRenderStatus(null)
    setCardDirty(true)
  }
  function handleCardLayoutChange(layout: StampCardLayout) {
    setCardLayout(layout)
    setCardDirty(true)
  }
  const cardDesignSrc = removeCard
    ? null
    : (cardDesignDataUrl ?? existingCardDesignUrl)
  const cardMarkSrc = removeCard ? null : (cardMarkDataUrl ?? existingMarkUrl)

  function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : null
      setImageDataUrl(result)
      setRemoveImage(false)
    }
    reader.readAsDataURL(file)
  }
  function handleImageRemove() {
    setImageDataUrl(null)
    setRemoveImage(!!existingImageUrl)
  }
  // Preview src — newly-picked file wins, then the existing presigned
  // URL. Hidden when removeImage flag is set.
  const imagePreviewSrc = removeImage
    ? null
    : (imageDataUrl ?? existingImageUrl)

  const onSaved = () => {
    void queryClient.invalidateQueries({ queryKey: ['pos', 'stamp-programs'] })
    setEditing(null)
  }
  const onError = (err: Error) => {
    toast({
      title: 'Gagal menyimpan',
      description: err.message,
      variant: 'error',
    })
  }

  const createMut = useMutation({
    mutationFn: () =>
      createStampProgram({
        data: {
          name: name.trim(),
          scope: scopeKind,
          categoryId: scopeKind === 'category' ? categoryId : null,
          productId: scopeKind === 'product' ? productId : null,
          itemIds: scopeKind === 'product_set' ? itemIds : null,
          stampsRequired: Number(stampsRequired) || 0,
          rewardMode,
          rewardItemId: rewardMode === 'single' ? rewardItemId : null,
          bundleItems:
            rewardMode === 'bundle'
              ? bundleItems.map((b) => ({
                  itemId: b.itemId,
                  quantity: Number(b.quantity) || 1,
                }))
              : null,
          imageDataUrl: imageDataUrl ?? undefined,
          removeImage: removeImage || undefined,
          cardDesignDataUrl:
            cardDirty && cardDesignDataUrl ? cardDesignDataUrl : undefined,
          stampMarkDataUrl:
            cardDirty && cardMarkDataUrl ? cardMarkDataUrl : undefined,
          cardLayout: cardDirty && cardLayout ? cardLayout : undefined,
          removeCard: cardDirty && removeCard ? true : undefined,
        },
      }),
    onSuccess: () => {
      toast({ title: 'Program stempel dibuat', variant: 'success' })
      onSaved()
    },
    onError,
  })
  const updateMut = useMutation({
    mutationFn: () =>
      updateStampProgram({
        data: {
          id: editing as string,
          name: name.trim(),
          stampsRequired: Number(stampsRequired) || 0,
          rewardMode,
          rewardItemId: rewardMode === 'single' ? rewardItemId : null,
          bundleItems:
            rewardMode === 'bundle'
              ? bundleItems.map((b) => ({
                  itemId: b.itemId,
                  quantity: Number(b.quantity) || 1,
                }))
              : null,
          imageDataUrl: imageDataUrl ?? undefined,
          removeImage: removeImage || undefined,
          cardDesignDataUrl:
            cardDirty && cardDesignDataUrl ? cardDesignDataUrl : undefined,
          stampMarkDataUrl:
            cardDirty && cardMarkDataUrl ? cardMarkDataUrl : undefined,
          cardLayout: cardDirty && cardLayout ? cardLayout : undefined,
          removeCard: cardDirty && removeCard ? true : undefined,
          isActive,
        },
      }),
    onSuccess: () => {
      toast({ title: 'Program stempel disimpan', variant: 'success' })
      onSaved()
    },
    onError,
  })

  // Hard-delete guard. Confirm-only when allowed; if the program has
  // customer history the server returns a friendly Indonesian error
  // which surfaces via the shared `onError` toast.
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const deleteMut = useMutation({
    mutationFn: () =>
      deleteStampProgram({ data: { id: editing as string } }),
    onSuccess: () => {
      toast({ title: 'Program stempel dihapus', variant: 'success' })
      setConfirmDelete(false)
      onSaved()
    },
    onError: (err: Error) => {
      setConfirmDelete(false)
      onError(err)
    },
  })

  const isCreating = editing === 'new'
  const saving = createMut.isPending || updateMut.isPending
  const scopeFilled =
    scopeKind === 'category'
      ? categoryId.length > 0
      : scopeKind === 'product'
        ? productId.length > 0
        : itemIds.length > 0
  const rewardFilled =
    rewardMode === 'single'
      ? rewardItemId.length > 0
      : bundleItems.length > 0 &&
        bundleItems.every(
          (b) => b.itemId.length > 0 && (Number(b.quantity) || 0) >= 1,
        )
  const canSave =
    name.trim().length > 0 &&
    scopeFilled &&
    rewardFilled &&
    (Number(stampsRequired) || 0) >= 1

  return (
    <Section title="Kartu Stempel">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Buat program "beli sekian kali, gratis 1" yang dihitung per
        kategori, per produk spesifik, atau per beberapa produk
        sekaligus. Misal kafe teh: pilih cakupan{' '}
        <span className="font-medium">per beberapa produk</span> agar
        beli "Teh Mangga" atau "Teh Leci" sama-sama menambah stempel.
        Hadiah juga bisa dalam bentuk{' '}
        <span className="font-medium">bundle</span> — misal "1 Teh
        Original + 1 Candy" saat kartu penuh.
      </p>

      {(() => {
        // Compute pagination once and stash on a const closure so the
        // visible rows and the pager below stay in sync.
        const total = programs.data?.length ?? 0
        const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
        // `page` can outrun totalPages when programs are deleted —
        // clamp at render rather than syncing state.
        const safePage = Math.min(page, totalPages - 1)
        const visible =
          programs.data?.slice(
            safePage * PAGE_SIZE,
            safePage * PAGE_SIZE + PAGE_SIZE,
          ) ?? []
        return (
          <>
      <div className="mt-3 space-y-2">
        {programs.isLoading && (
          <p className="text-xs text-gray-500 dark:text-gray-400">Memuat…</p>
        )}
        {programs.data?.length === 0 && !programs.isLoading && (
          <p className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
            Belum ada program. Klik "Tambah program" untuk mulai.
          </p>
        )}
        {visible.map((p) => (
          <div
            key={p.id}
            className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
          >
            {p.imageUrl ? (
              <img
                src={p.imageUrl}
                alt=""
                className="h-10 w-10 shrink-0 rounded-md border border-gray-200 object-cover dark:border-gray-700"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-50 dark:bg-brand-900/30">
                <Stamp className="h-5 w-5 text-brand-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {p.name}
                </p>
                {!p.isActive && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    Nonaktif
                  </span>
                )}
              </div>
              <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                {p.scope === 'product'
                  ? `Produk ${p.productName ?? '—'}`
                  : p.scope === 'product_set'
                    ? `${p.scopeItems.length} produk: ${p.scopeItems
                        .slice(0, 3)
                        .map((s) => s.itemName)
                        .join(', ')}${
                        p.scopeItems.length > 3 ? '…' : ''
                      }`
                    : `Kategori ${p.categoryName ?? '—'}`}{' '}
                · {p.stampsRequired} stempel → gratis{' '}
                {p.rewardMode === 'bundle'
                  ? p.bundleRewards
                      .map((b) => `${b.quantity}× ${b.itemName}`)
                      .join(' + ') || '—'
                  : (p.rewardItemName ?? '—')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openEdit(p)}
              className="shrink-0 rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
              aria-label="Ubah program"
            >
              <Pencil className="h-4 w-4" />
            </button>
          </div>
        ))}

        {editing === null ? (
          <Button
            type="button"
            variant="ghost"
            onClick={openCreate}
            className="w-full"
          >
            <Plus className="mr-1 h-4 w-4" /> Tambah program
          </Button>
        ) : (
          <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-800 dark:bg-brand-900/10">
            <Input
              label="Nama program"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="cth. Cuci Motor"
            />
            {/* Optional banner image — surfaces in admin list,
                cashier strip, and the situs Stamp section. Pattern
                mirrors the promo banner picker. */}
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Gambar program (opsional)
              </label>
              {imagePreviewSrc ? (
                <div className="relative inline-block">
                  <img
                    src={imagePreviewSrc}
                    alt="Preview gambar program"
                    className="h-32 max-w-full rounded-lg border border-gray-200 object-cover dark:border-gray-700"
                  />
                  <button
                    type="button"
                    onClick={handleImageRemove}
                    className="absolute -right-2 -top-2 rounded-full bg-white p-1 text-gray-500 shadow ring-1 ring-gray-200 hover:text-danger-600 dark:bg-gray-800 dark:ring-gray-700"
                    aria-label="Hapus gambar"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
                  <ImagePlus className="h-6 w-6" />
                  <span>Tambah gambar (maks. 2 MB)</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImagePick}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            <StampCardEditor
              key={editing ?? 'none'}
              stampsRequired={Math.max(1, Number(stampsRequired) || 1)}
              designSrc={cardDesignSrc}
              markSrc={cardMarkSrc}
              initialLayout={cardLayout}
              renderStatus={cardRenderStatus}
              onPickDesign={handleCardDesignPick}
              onPickMark={handleCardMarkPick}
              onRemove={handleCardRemove}
              onLayoutChange={handleCardLayoutChange}
            />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Cakupan
              </p>
              {/* Three-segment radio: kategori, produk spesifik, atau
                  beberapa produk. Locked after creation because changing
                  scope would orphan every existing customer card on
                  this program. */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(
                  [
                    { value: 'category', label: 'Per kategori' },
                    { value: 'product', label: 'Per produk' },
                    { value: 'product_set', label: 'Per beberapa produk' },
                  ] as const
                ).map((k) => (
                  <label
                    key={k.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                      scopeKind === k.value
                        ? 'border-brand-500 bg-white text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    } ${isCreating ? '' : 'cursor-not-allowed opacity-60'}`}
                  >
                    <input
                      type="radio"
                      name="stamp-scope"
                      value={k.value}
                      checked={scopeKind === k.value}
                      onChange={() => isCreating && setScopeKind(k.value)}
                      disabled={!isCreating}
                      className="accent-brand-600"
                    />
                    {k.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {scopeKind === 'category'
                  ? 'Setiap produk di kategori ini akan menambah stempel.'
                  : scopeKind === 'product'
                    ? 'Hanya produk yang dipilih yang menambah stempel.'
                    : 'Setiap produk dalam daftar di bawah akan menambah stempel (tidak dijumlahkan).'}
              </p>
            </div>
            {scopeKind === 'category' && (
              <Select
                label="Kategori produk yang dihitung"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                placeholder="Pilih kategori"
                disabled={!isCreating}
                options={(masters.data?.categories ?? []).map((c) => ({
                  label: c.name,
                  value: c.id,
                }))}
              />
            )}
            {scopeKind === 'product' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Produk yang dihitung
                </label>
                <Combobox
                  value={productId}
                  onChange={setProductId}
                  placeholder="Pilih produk"
                  searchPlaceholder="Cari produk…"
                  emptyResultLabel="Produk tidak ditemukan"
                  disabled={!isCreating}
                  clearable={false}
                  options={(masters.data?.items ?? []).map((i) => ({
                    label: i.name,
                    value: i.id,
                  }))}
                />
              </div>
            )}
            {scopeKind === 'product_set' && (
              <ItemListEditor
                label="Produk yang dihitung"
                items={itemIds.map((id) => ({ itemId: id }))}
                onChange={(rows) => setItemIds(rows.map((r) => r.itemId))}
                disabled={!isCreating}
                allItems={masters.data?.items ?? []}
                emptyHint="Belum ada produk. Tambah produk di bawah."
                addLabel="Tambah produk"
              />
            )}
            {!isCreating && (
              <p className="-mt-1.5 text-xs text-gray-500 dark:text-gray-400">
                Cakupan tidak bisa diubah setelah program dibuat.
              </p>
            )}
            <Input
              label="Jumlah stempel untuk 1 hadiah"
              type="number"
              min={1}
              max={100}
              value={stampsRequired}
              onChange={(e) => setStampsRequired(e.target.value)}
            />
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Hadiah
              </p>
              {/* Reward mode: single = 1 produk gratis; bundle = N produk
                  dengan kuantitas masing-masing. Switching mode in the
                  editor mid-life is allowed because customer card
                  progress (currentStamps / lifetime) is independent of
                  the reward shape. */}
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { value: 'single', label: '1 produk gratis' },
                    { value: 'bundle', label: 'Bundle (banyak produk)' },
                  ] as const
                ).map((m) => (
                  <label
                    key={m.value}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition ${
                      rewardMode === m.value
                        ? 'border-brand-500 bg-white text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="stamp-reward-mode"
                      value={m.value}
                      checked={rewardMode === m.value}
                      onChange={() => setRewardMode(m.value)}
                      className="accent-brand-600"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
            {rewardMode === 'single' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Produk hadiah (gratis saat kartu penuh)
                </label>
                <Combobox
                  value={rewardItemId}
                  onChange={setRewardItemId}
                  placeholder="Pilih produk hadiah"
                  searchPlaceholder="Cari produk…"
                  emptyResultLabel="Produk tidak ditemukan"
                  clearable={false}
                  options={(masters.data?.items ?? []).map((i) => ({
                    label: i.name,
                    value: i.id,
                  }))}
                />
              </div>
            )}
            {rewardMode === 'bundle' && (
              <ItemListEditor
                label="Bundle hadiah (gratis saat kartu penuh)"
                items={bundleItems}
                onChange={(rows) =>
                  setBundleItems(
                    rows.map((r) => ({
                      itemId: r.itemId,
                      quantity: r.quantity ?? '1',
                    })),
                  )
                }
                allItems={masters.data?.items ?? []}
                showQuantity
                emptyHint="Belum ada produk dalam bundle. Tambah produk di bawah."
                addLabel="Tambah produk bundle"
              />
            )}
            {!isCreating && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Program aktif</span>
              </label>
            )}
            <div className="flex items-center justify-between gap-2">
              {/* Delete sits on the LEFT, opposite Batal/Simpan, so it
                  visually reads as a destructive escape hatch rather
                  than the primary action. Only shown when editing an
                  existing program (creation never needs delete). */}
              {!isCreating ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving || deleteMut.isPending}
                  className="text-danger-600 hover:bg-danger-50 hover:text-danger-700"
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Hapus
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditing(null)}
                  disabled={saving}
                >
                  Batal
                </Button>
                <Button
                  type="button"
                  variant="brand"
                  loading={saving}
                  disabled={!canSave}
                  onClick={() =>
                    isCreating ? createMut.mutate() : updateMut.mutate()
                  }
                >
                  Simpan
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      {totalPages > 1 && (
        <nav
          className="mt-3 flex items-center justify-between gap-2 text-xs"
          aria-label="Navigasi halaman"
        >
          <p className="text-gray-500 dark:text-gray-400">
            Halaman {safePage + 1} dari {totalPages} · {total} program
          </p>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="rounded-md px-2.5 py-1.5 font-medium text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Sebelumnya
            </button>
            <button
              type="button"
              onClick={() =>
                setPage(Math.min(totalPages - 1, safePage + 1))
              }
              disabled={safePage === totalPages - 1}
              className="rounded-md px-2.5 py-1.5 font-medium text-gray-600 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Berikutnya
            </button>
          </div>
        </nav>
      )}
          </>
        )
      })()}
      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteMut.mutate()}
        title="Hapus program stempel?"
        description="Program akan dihapus permanen. Hanya bisa dihapus jika belum pernah dipakai pelanggan — kalau sudah, server akan menolak dan kamu bisa nonaktifkan saja."
        confirmText="Hapus"
        cancelText="Batal"
        variant="danger"
        loading={deleteMut.isPending}
      />
    </Section>
  )
}

type ItemListRow = { itemId: string; quantity?: string }

/**
 * Shared editor for "list of products" fields — used for product_set
 * scope (no qty) and bundle rewards (with qty). Each row is a
 * searchable product picker + optional qty input + trash button. Adds
 * a new empty row on demand.
 */
function ItemListEditor({
  label,
  items,
  onChange,
  allItems,
  showQuantity = false,
  disabled = false,
  emptyHint,
  addLabel,
}: {
  label: string
  items: ItemListRow[]
  onChange: (rows: ItemListRow[]) => void
  allItems: Array<{ id: string; name: string }>
  showQuantity?: boolean
  disabled?: boolean
  emptyHint: string
  addLabel: string
}) {
  // Disable already-picked options in the per-row dropdown so the same
  // product can't be added twice (server rejects duplicates anyway,
  // but this catches it earlier).
  const pickedIds = new Set(items.map((r) => r.itemId).filter(Boolean))
  function setRow(idx: number, patch: Partial<ItemListRow>) {
    onChange(items.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function removeRow(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }
  function addRow() {
    onChange([...items, { itemId: '', quantity: showQuantity ? '1' : undefined }])
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      {items.length === 0 && (
        <p className="rounded-md border border-dashed border-gray-300 p-3 text-xs text-gray-500 dark:border-gray-600 dark:text-gray-400">
          {emptyHint}
        </p>
      )}
      <div className="space-y-2">
        {items.map((row, idx) => {
          const options = allItems
            .filter((i) => i.id === row.itemId || !pickedIds.has(i.id))
            .map((i) => ({ label: i.name, value: i.id }))
          return (
            <div key={idx} className="flex items-start gap-2">
              <div className="flex-1">
                <Combobox
                  value={row.itemId}
                  onChange={(v) => setRow(idx, { itemId: v })}
                  placeholder="Pilih produk"
                  searchPlaceholder="Cari produk…"
                  emptyResultLabel="Produk tidak ditemukan"
                  disabled={disabled}
                  clearable={false}
                  options={options}
                />
              </div>
              {showQuantity && (
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={row.quantity ?? '1'}
                  onChange={(e) =>
                    setRow(idx, { quantity: e.target.value })
                  }
                  className="w-20"
                  aria-label="Jumlah"
                />
              )}
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => removeRow(idx)}
                  aria-label="Hapus baris"
                  className="!px-2"
                >
                  <Trash2 className="h-4 w-4 text-gray-400" />
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {!disabled && (
        <Button
          type="button"
          variant="ghost"
          onClick={addRow}
          className="w-full"
        >
          <Plus className="mr-1 h-4 w-4" /> {addLabel}
        </Button>
      )}
    </div>
  )
}

// ─── Aktivitas Stempel ──────────────────────────────────────────────
// Per-program leaderboard + period summary. Defaults to the first
// active program and "Hari ini"; switching either re-queries.
// Self-contained — loads its own program list (cheap, reuses the
// same react-query key as the management section above).

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Hari ini' },
  { value: 'week', label: 'Minggu ini' },
  { value: 'month', label: 'Bulan ini' },
  { value: 'year', label: 'Tahun ini' },
] as const

type Period = (typeof PERIOD_OPTIONS)[number]['value']

function StampActivitySection() {
  const programs = useQuery({
    queryKey: ['pos', 'stamp-programs'],
    queryFn: () => listStampPrograms(),
  })
  // Drop archived programs — analytics on a deactivated card aren't
  // actionable, and showing them in the dropdown adds clutter.
  const activePrograms = React.useMemo(
    () => (programs.data ?? []).filter((p) => p.isActive),
    [programs.data],
  )

  const [programId, setProgramId] = React.useState<string>('')
  const [period, setPeriod] = React.useState<Period>('today')

  // Default to the first active program once the list loads.
  React.useEffect(() => {
    if (!programId && activePrograms.length > 0) {
      setProgramId(activePrograms[0]!.id)
    }
    // If the selected program is no longer active (got archived in the
    // upper section), fall back to the first active one.
    if (
      programId &&
      activePrograms.length > 0 &&
      !activePrograms.find((p) => p.id === programId)
    ) {
      setProgramId(activePrograms[0]!.id)
    }
  }, [activePrograms, programId])

  const activity = useQuery({
    queryKey: ['pos', 'stamp-activity', programId, period],
    queryFn: () => getStampActivity({ data: { programId, period } }),
    enabled: !!programId,
    staleTime: 30 * 1000,
  })

  if (programs.isLoading) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
          Aktivitas Stempel
        </h3>
        <p className="text-sm text-gray-500">Memuat program…</p>
      </div>
    )
  }
  if (activePrograms.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h3 className="mb-3 text-base font-semibold text-gray-900 dark:text-gray-100">
          Aktivitas Stempel
        </h3>
        <p className="text-sm text-gray-500">
          Belum ada program stempel aktif. Buat program di atas dulu, lalu
          aktivitas pelanggan akan muncul di sini.
        </p>
      </div>
    )
  }

  const periodLabel =
    PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? ''

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Aktivitas Stempel
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Lihat siapa yang paling rajin ngumpulin stempel periode ini, dan
            berapa banyak hadiah yang sudah dibagikan.
          </p>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Select
          label="Program"
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          options={activePrograms.map((p) => ({
            label: p.name,
            value: p.id,
          }))}
        />
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Periode
          </label>
          <div className="grid grid-cols-4 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={cn(
                  'rounded-md py-1.5 text-xs font-medium transition-colors',
                  period === p.value
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                    : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activity.isLoading ? (
        <p className="text-sm text-gray-500">Memuat aktivitas…</p>
      ) : activity.error ? (
        <p className="text-sm text-danger-600">
          {activity.error instanceof Error
            ? activity.error.message
            : 'Gagal memuat aktivitas.'}
        </p>
      ) : activity.data ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Stempel diberikan"
              value={formatNumberId(activity.data.summary.stampsEarned)}
              hint={periodLabel}
            />
            <StatCard
              label="Stempel ditukar"
              value={formatNumberId(activity.data.summary.stampsRedeemed)}
              hint={periodLabel}
            />
            <StatCard
              label="Hadiah dibagikan"
              value={formatNumberId(activity.data.summary.rewardsClaimed)}
              hint={periodLabel}
            />
            <StatCard
              label="Pelanggan aktif"
              value={formatNumberId(activity.data.summary.activeCustomers)}
              hint={periodLabel}
            />
          </div>

          {activity.data.topMembers.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 p-4 text-center text-xs text-gray-500 dark:border-gray-600">
              Belum ada aktivitas {periodLabel.toLowerCase()} di program ini.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200 text-xs uppercase tracking-wider text-gray-500 dark:border-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left">Pelanggan</th>
                    <th className="px-3 py-2 text-right">
                      Stempel {periodLabel.toLowerCase()}
                    </th>
                    <th className="px-3 py-2 text-right">Kartu saat ini</th>
                    <th className="hidden px-3 py-2 text-right sm:table-cell">
                      Total seumur hidup
                    </th>
                    <th className="hidden px-3 py-2 text-right sm:table-cell">
                      Hadiah diklaim
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {activity.data.topMembers.map((m) => (
                    <tr key={m.customerId}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {m.customerName}
                        </p>
                        {m.customerPhone && (
                          <p className="text-xs text-gray-500">
                            {m.customerPhone}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="font-semibold text-brand-700 dark:text-brand-300">
                          +{formatNumberId(m.stampsInPeriod)}
                        </span>
                        {m.rewardsInPeriod > 0 && (
                          <span className="ml-1 text-xs text-gray-500">
                            · {m.rewardsInPeriod} hadiah
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">
                        {m.currentStamps}/{activity.data.program.stampsRequired}
                      </td>
                      <td className="hidden px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300 sm:table-cell">
                        {formatNumberId(m.lifetimeStamps)}
                      </td>
                      <td className="hidden px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300 sm:table-cell">
                        {formatNumberId(m.lifetimeRewards)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {activity.data.topMembers.length === 20 && (
                <p className="mt-2 text-center text-xs text-gray-500">
                  Menampilkan 20 pelanggan teratas.
                </p>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800/40">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
        {value}
      </p>
      {hint && (
        <p className="text-[10px] uppercase tracking-wider text-gray-400">
          {hint}
        </p>
      )}
    </div>
  )
}
