/**
 * Peti Kas (cash session) bottom sheet for the mobile Kasir.
 *
 * Views:
 *   - open    → Buka Kasir form (modal awal)
 *   - summary → totals (modal awal / penjualan tunai / kas keluar /
 *               perkiraan kas) + movement ledger + Setor / Tarik / Tutup
 *   - setor   → Setor Tunai (cash to safe)   → recordCashDrop
 *   - tarik   → Tarik Tunai (paid out)       → recordCashPayout
 *   - tutup   → count physical cash → variance → closeCashSession
 *   - done    → close result (selisih) summary
 *
 * Cash sales auto-record into the session server-side, so this only
 * drives open / manual cash-out / close.
 */
import { useEffect, useState } from 'react'
import { Pressable, TextInput } from 'react-native'
import { ScrollView, Sheet, Spinner, XStack, YStack, Paragraph } from 'tamagui'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle,
  ChevronLeft,
  Clock,
  Wallet,
  X,
} from '~/lib/icons'
import {
  useActiveCashSession,
  useOpenCashSession,
  useRecordCashDrop,
  useRecordCashPayout,
  useCloseCashSession,
  useExpenseCategories,
  expectedCash,
  type CashSession,
  type CashMovement,
  type CloseSessionResult,
} from '../../lib/pos-cash'
import { formatRupiah } from '../../lib/currency'
import { COLORS, FONTS } from '../../lib/theme'

type View = 'open' | 'summary' | 'setor' | 'tarik' | 'tutup'

export function PetiKasSheet({
  open,
  onClose,
  branchId,
}: {
  open: boolean
  onClose: () => void
  branchId: string
}) {
  const query = useActiveCashSession(branchId, open)
  const session = query.data?.session ?? null
  const movements = query.data?.movements ?? []

  const [view, setView] = useState<View>('summary')
  const [result, setResult] = useState<CloseSessionResult | null>(null)

  // Land on the right view when the sheet opens or the session
  // appears/disappears. The close result is shown by `result`, not a view.
  useEffect(() => {
    if (!open) {
      setResult(null)
      return
    }
    if (!result) setView(session ? 'summary' : 'open')
  }, [open, session?.id, result])

  return (
    <Sheet open={open} onOpenChange={onClose} snapPoints={[88]} modal>
      <Sheet.Overlay />
      <Sheet.Frame padding="$4" gap="$3" bg={COLORS.background}>
        <Sheet.Handle />
        <Header
          title={
            result
              ? 'Kasir Ditutup'
              : view === 'open'
                ? 'Buka Kasir'
                : view === 'setor'
                  ? 'Setor Tunai'
                  : view === 'tarik'
                    ? 'Tarik Tunai'
                    : view === 'tutup'
                      ? 'Tutup Kasir'
                      : 'Peti Kas'
          }
          onBack={
            !result && (view === 'setor' || view === 'tarik' || view === 'tutup')
              ? () => setView('summary')
              : undefined
          }
          onClose={onClose}
        />

        {query.isLoading && !query.data ? (
          <YStack flex={1} ai="center" jc="center">
            <Spinner color={COLORS.primary} size="large" />
          </YStack>
        ) : result ? (
          <CloseResultView result={result} onDone={onClose} />
        ) : !session || view === 'open' ? (
          <OpenForm branchId={branchId} />
        ) : view === 'setor' || view === 'tarik' ? (
          <MovementForm
            session={session}
            kind={view}
            onDone={() => setView('summary')}
          />
        ) : view === 'tutup' ? (
          <CloseForm
            session={session}
            onClosed={(r) => setResult(r)}
          />
        ) : (
          <Summary
            session={session}
            movements={movements}
            onSetor={() => setView('setor')}
            onTarik={() => setView('tarik')}
            onTutup={() => setView('tutup')}
          />
        )}
      </Sheet.Frame>
    </Sheet>
  )
}

// ─── Views ───────────────────────────────────────────────────────────

function OpenForm({ branchId }: { branchId: string }) {
  const openSession = useOpenCashSession()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    openSession.mutate(
      {
        branchId,
        openingBalance: Number(amount || '0'),
        openingNotes: note.trim() || undefined,
      },
      {
        onError: (e) =>
          setError(e instanceof Error ? e.message : 'Gagal membuka kasir'),
      },
    )
  }

  return (
    <YStack gap="$3" pt="$1">
      <Paragraph fontFamily={FONTS.body} fontSize={13} color={COLORS.onSurfaceVariant}>
        Hitung uang tunai di laci sebagai modal awal, lalu buka kasir untuk
        mulai mencatat transaksi tunai.
      </Paragraph>
      <AmountField label="Modal awal" value={amount} onChange={setAmount} />
      <NoteField label="Catatan (opsional)" value={note} onChange={setNote} />
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton
        label="Buka Kasir"
        loading={openSession.isPending}
        onPress={submit}
      />
    </YStack>
  )
}

function Summary({
  session,
  movements,
  onSetor,
  onTarik,
  onTutup,
}: {
  session: CashSession
  movements: CashMovement[]
  onSetor: () => void
  onTarik: () => void
  onTutup: () => void
}) {
  const expected = expectedCash(session)
  return (
    <YStack flex={1} gap="$3">
      <XStack ai="center" gap="$1.5">
        <Clock size={13} color={COLORS.onSurfaceVariant} />
        <Paragraph fontFamily={FONTS.body} fontSize={12} color={COLORS.onSurfaceVariant}>
          Dibuka {formatTime(session.openedAt)}
        </Paragraph>
      </XStack>

      {/* Expected cash hero */}
      <YStack bg={COLORS.primary} br={16} p="$4" gap={2}>
        <Paragraph fontFamily={FONTS.bodySemi} fontSize={12} color="white" opacity={0.85}>
          Perkiraan kas di laci
        </Paragraph>
        <Paragraph fontFamily={FONTS.headingBold} fontSize={26} color="white">
          {formatRupiah(expected)}
        </Paragraph>
      </YStack>

      <XStack gap="$3">
        <MiniStat label="Modal awal" value={formatRupiah(Number(session.openingBalance))} />
        <MiniStat label="Penjualan tunai" value={formatRupiah(Number(session.cashInTotal))} />
        <MiniStat label="Kas keluar" value={formatRupiah(Number(session.cashOutTotal))} />
      </XStack>

      <XStack gap="$2.5">
        <ActionButton
          icon={<ArrowDownToLine size={16} color={COLORS.primary} />}
          label="Setor"
          onPress={onSetor}
        />
        <ActionButton
          icon={<ArrowUpFromLine size={16} color={COLORS.primary} />}
          label="Tarik"
          onPress={onTarik}
        />
        <ActionButton
          icon={<Wallet size={16} color={COLORS.secondary} />}
          label="Tutup"
          tint={COLORS.secondaryContainer}
          onPress={onTutup}
        />
      </XStack>

      <Paragraph fontFamily={FONTS.bodySemi} fontSize={12} color={COLORS.onSurfaceVariant} mt="$1">
        Riwayat kas
      </Paragraph>
      <ScrollView flex={1} showsVerticalScrollIndicator={false}>
        <YStack gap="$2" pb="$2">
          {movements.length === 0 ? (
            <Paragraph fontFamily={FONTS.body} fontSize={13} color={COLORS.onSurfaceVariant}>
              Belum ada pergerakan kas.
            </Paragraph>
          ) : (
            movements.map((m) => <MovementRow key={m.id} m={m} />)
          )}
        </YStack>
      </ScrollView>
    </YStack>
  )
}

function MovementForm({
  session,
  kind,
  onDone,
}: {
  session: CashSession
  kind: 'setor' | 'tarik'
  onDone: () => void
}) {
  const drop = useRecordCashDrop()
  const payout = useRecordCashPayout()
  const isTarik = kind === 'tarik'
  const mutation = isTarik ? payout : drop
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Tarik Tunai books a cashflow expense → let the cashier tag it.
  const { data: categories = [] } = useExpenseCategories(isTarik)
  useEffect(() => {
    if (!isTarik || categoryId || categories.length === 0) return
    const fallback =
      categories.find((c) => c.isSystem && c.name === 'Pengeluaran Kas') ??
      categories[0]
    if (fallback) setCategoryId(fallback.id)
  }, [isTarik, categoryId, categories])

  function submit() {
    setError(null)
    const amt = Number(amount || '0')
    if (amt < 1) {
      setError('Jumlah minimal Rp 1')
      return
    }
    if (!reason.trim()) {
      setError('Alasan wajib diisi')
      return
    }
    mutation.mutate(
      {
        sessionId: session.id,
        amount: amt,
        reason: reason.trim(),
        ...(isTarik ? { categoryId: categoryId ?? undefined } : {}),
      },
      {
        onSuccess: onDone,
        onError: (e) =>
          setError(e instanceof Error ? e.message : 'Gagal mencatat kas'),
      },
    )
  }

  return (
    <YStack gap="$3" pt="$1">
      <Paragraph fontFamily={FONTS.body} fontSize={13} color={COLORS.onSurfaceVariant}>
        {isTarik
          ? 'Uang tunai keluar untuk pengeluaran usaha (mis. beli kebutuhan).'
          : 'Uang tunai keluar dari laci (mis. disetor ke brankas/pemilik).'}
      </Paragraph>
      <AmountField label="Jumlah" value={amount} onChange={setAmount} />
      <NoteField label="Alasan" value={reason} onChange={setReason} />
      {isTarik && (
        <YStack gap="$1.5">
          <Paragraph fontFamily={FONTS.bodyMedium} fontSize={13} color={COLORS.onSurfaceVariant}>
            Kategori pengeluaran
          </Paragraph>
          <XStack flexWrap="wrap" gap="$2">
            {categories.map((c) => {
              const selected = c.id === categoryId
              return (
                <Pressable key={c.id} onPress={() => setCategoryId(c.id)}>
                  <XStack
                    px="$3"
                    h={34}
                    ai="center"
                    br={9999}
                    bg={selected ? COLORS.secondaryContainer : COLORS.surfaceContainerLowest}
                    borderWidth={1}
                    borderColor={selected ? COLORS.secondary : COLORS.outlineVariant}
                  >
                    <Paragraph
                      fontFamily={FONTS.bodySemi}
                      fontSize={12}
                      color={selected ? COLORS.onSecondaryContainer : COLORS.onSurfaceVariant}
                    >
                      {c.name}
                    </Paragraph>
                  </XStack>
                </Pressable>
              )
            })}
          </XStack>
          <Paragraph fontFamily={FONTS.body} fontSize={11} color={COLORS.onSurfaceVariant}>
            Otomatis tercatat sebagai pengeluaran di Arus Kas.
          </Paragraph>
        </YStack>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton
        label={isTarik ? 'Tarik Tunai' : 'Setor Tunai'}
        loading={mutation.isPending}
        onPress={submit}
      />
    </YStack>
  )
}

function CloseForm({
  session,
  onClosed,
}: {
  session: CashSession
  onClosed: (r: CloseSessionResult) => void
}) {
  const close = useCloseCashSession()
  const expected = expectedCash(session)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const counted = amount === '' ? null : Number(amount)
  const variance = counted === null ? null : counted - expected

  function submit(force: boolean) {
    setError(null)
    close.mutate(
      {
        sessionId: session.id,
        actualClosing: force ? 0 : Number(amount || '0'),
        closingNotes: note.trim() || undefined,
        forceClosed: force,
      },
      {
        onSuccess: onClosed,
        onError: (e) =>
          setError(e instanceof Error ? e.message : 'Gagal menutup kasir'),
      },
    )
  }

  return (
    <YStack gap="$3" pt="$1">
      <XStack jc="space-between">
        <Paragraph fontFamily={FONTS.body} fontSize={13} color={COLORS.onSurfaceVariant}>
          Perkiraan kas
        </Paragraph>
        <Paragraph fontFamily={FONTS.bodyBold} fontSize={13} color={COLORS.onSurface}>
          {formatRupiah(expected)}
        </Paragraph>
      </XStack>
      <AmountField label="Uang fisik dihitung" value={amount} onChange={setAmount} />
      {variance !== null && (
        <XStack jc="space-between">
          <Paragraph fontFamily={FONTS.body} fontSize={13} color={COLORS.onSurfaceVariant}>
            Selisih
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={13}
            color={
              variance === 0
                ? COLORS.success
                : variance > 0
                  ? COLORS.primary
                  : COLORS.danger
            }
          >
            {variance > 0 ? '+' : ''}
            {formatRupiah(variance)}
          </Paragraph>
        </XStack>
      )}
      <NoteField label="Catatan (opsional)" value={note} onChange={setNote} />
      {error && <ErrorText>{error}</ErrorText>}
      <PrimaryButton
        label="Tutup Kasir"
        loading={close.isPending}
        onPress={() => submit(false)}
      />
      <Pressable onPress={() => submit(true)} disabled={close.isPending}>
        <Paragraph
          ta="center"
          fontFamily={FONTS.bodyMedium}
          fontSize={12}
          color={COLORS.onSurfaceVariant}
          py="$1"
        >
          Tutup paksa tanpa hitung
        </Paragraph>
      </Pressable>
    </YStack>
  )
}

function CloseResultView({
  result,
  onDone,
}: {
  result: CloseSessionResult
  onDone: () => void
}) {
  const v = result.variance
  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$4">
      <CheckCircle size={56} color={COLORS.success} />
      <Paragraph fontFamily={FONTS.headingBold} fontSize={18} color={COLORS.onSurface}>
        Kasir berhasil ditutup
      </Paragraph>
      <YStack
        w="100%"
        bg={COLORS.surfaceContainerLowest}
        br={16}
        p="$4"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
      >
        <KvRow label="Perkiraan kas" value={formatRupiah(result.expectedClosing)} />
        <KvRow label="Uang dihitung" value={formatRupiah(result.actualClosing)} />
        <KvRow
          label="Selisih"
          value={`${v > 0 ? '+' : ''}${formatRupiah(v)}`}
          color={v === 0 ? COLORS.success : v > 0 ? COLORS.primary : COLORS.danger}
        />
      </YStack>
      <PrimaryButton label="Selesai" onPress={onDone} />
    </YStack>
  )
}

// ─── Atoms ─────────────────────────────────────────────────────────

function Header({
  title,
  onBack,
  onClose,
}: {
  title: string
  onBack?: () => void
  onClose: () => void
}) {
  return (
    <XStack ai="center" jc="space-between">
      <XStack ai="center" gap="$2" flex={1}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={8}>
            <ChevronLeft size={22} color={COLORS.onSurface} />
          </Pressable>
        )}
        <Paragraph fontFamily={FONTS.headingBold} fontSize={18} color={COLORS.onSurface}>
          {title}
        </Paragraph>
      </XStack>
      <Pressable onPress={onClose} hitSlop={8}>
        <YStack w={32} h={32} br={16} bg={COLORS.surfaceContainerHigh} ai="center" jc="center">
          <X size={16} color={COLORS.onSurfaceVariant} />
        </YStack>
      </Pressable>
    </XStack>
  )
}

function AmountField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <YStack gap="$1.5">
      <Paragraph fontFamily={FONTS.bodyMedium} fontSize={13} color={COLORS.onSurfaceVariant}>
        {label}
      </Paragraph>
      <XStack
        ai="center"
        gap="$2"
        h={48}
        px="$3.5"
        br={12}
        bg={COLORS.surfaceContainerLowest}
        borderWidth={1}
        borderColor={COLORS.outlineVariant}
      >
        <Paragraph fontFamily={FONTS.bodyBold} fontSize={15} color={COLORS.onSurfaceVariant}>
          Rp
        </Paragraph>
        <TextInput
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9]/g, ''))}
          placeholder="0"
          placeholderTextColor={COLORS.outline}
          keyboardType="number-pad"
          style={{
            flex: 1,
            padding: 0,
            fontFamily: FONTS.monoMedium,
            fontSize: 16,
            color: COLORS.onSurface,
          }}
        />
      </XStack>
    </YStack>
  )
}

function NoteField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <YStack gap="$1.5">
      <Paragraph fontFamily={FONTS.bodyMedium} fontSize={13} color={COLORS.onSurfaceVariant}>
        {label}
      </Paragraph>
      <YStack
        px="$3.5"
        py="$2.5"
        br={12}
        bg={COLORS.surfaceContainerLowest}
        borderWidth={1}
        borderColor={COLORS.outlineVariant}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Tulis di sini..."
          placeholderTextColor={COLORS.outline}
          multiline
          style={{
            minHeight: 36,
            padding: 0,
            fontFamily: FONTS.body,
            fontSize: 14,
            color: COLORS.onSurface,
          }}
        />
      </YStack>
    </YStack>
  )
}

function PrimaryButton({
  label,
  onPress,
  loading,
}: {
  label: string
  onPress: () => void
  loading?: boolean
}) {
  return (
    <Pressable onPress={loading ? undefined : onPress}>
      <XStack
        h={50}
        br={9999}
        bg={COLORS.primary}
        ai="center"
        jc="center"
        gap="$2"
        opacity={loading ? 0.7 : 1}
      >
        {loading && <Spinner color="white" />}
        <Paragraph fontFamily={FONTS.bodyBold} fontSize={15} color="white">
          {label}
        </Paragraph>
      </XStack>
    </Pressable>
  )
}

function ActionButton({
  icon,
  label,
  tint,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  tint?: string
  onPress: () => void
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <YStack
        ai="center"
        jc="center"
        gap="$1.5"
        py="$3"
        br={14}
        bg={tint ?? COLORS.primaryFixed}
      >
        {icon}
        <Paragraph fontFamily={FONTS.bodySemi} fontSize={12} color={COLORS.onSurface}>
          {label}
        </Paragraph>
      </YStack>
    </Pressable>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <YStack
      flex={1}
      bg={COLORS.surfaceContainerLowest}
      br={12}
      p="$2.5"
      gap={2}
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
    >
      <Paragraph fontFamily={FONTS.body} fontSize={10} color={COLORS.onSurfaceVariant} numberOfLines={1}>
        {label}
      </Paragraph>
      <Paragraph fontFamily={FONTS.bodyBold} fontSize={13} color={COLORS.onSurface} numberOfLines={1}>
        {value}
      </Paragraph>
    </YStack>
  )
}

function MovementRow({ m }: { m: CashMovement }) {
  const isIn = m.type === 'sale'
  const sign = isIn ? '+' : '−'
  const label =
    m.type === 'sale'
      ? `Penjualan ${m.referenceSaleNumber ?? ''}`.trim()
      : m.type === 'refund'
        ? 'Refund'
        : m.type === 'drop'
          ? 'Setor tunai'
          : 'Tarik tunai'
  return (
    <XStack jc="space-between" ai="center" py="$1">
      <YStack flex={1}>
        <Paragraph fontFamily={FONTS.bodyMedium} fontSize={13} color={COLORS.onSurface} numberOfLines={1}>
          {label}
        </Paragraph>
        {m.reason && (
          <Paragraph fontFamily={FONTS.body} fontSize={11} color={COLORS.onSurfaceVariant} numberOfLines={1}>
            {m.reason}
          </Paragraph>
        )}
      </YStack>
      <Paragraph
        fontFamily={FONTS.monoMedium}
        fontSize={13}
        color={isIn ? COLORS.primary : COLORS.danger}
      >
        {sign} {formatRupiah(Number(m.amount))}
      </Paragraph>
    </XStack>
  )
}

function KvRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <XStack jc="space-between" ai="center">
      <Paragraph fontFamily={FONTS.body} fontSize={13} color={COLORS.onSurfaceVariant}>
        {label}
      </Paragraph>
      <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color={color ?? COLORS.onSurface}>
        {value}
      </Paragraph>
    </XStack>
  )
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <Paragraph fontFamily={FONTS.body} fontSize={13} color={COLORS.danger}>
      {children}
    </Paragraph>
  )
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}
