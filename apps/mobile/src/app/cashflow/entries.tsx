/**
 * Catatan Kas — manual entries ledger. Filter by date range + type,
 * create/edit/delete entries via sheet. POS-imported entries (source =
 * 'pos_sale') are listed but not editable.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  Edit,
  FileText,
  Plus,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useCashflowAccounts,
  useCashflowCategories,
  useCashflowEntries,
  useCreateCashflowEntry,
  useDeleteCashflowEntry,
  useUpdateCashflowEntry,
  type CashflowEntry,
  type CashflowKind,
} from '~/lib/cashflow'
import { ApiError } from '~/lib/api'
import { formatRupiah, parseRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

function ymd(d: Date): string {
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const jak = new Date(utcMs + 7 * 60 * 60_000)
  return `${jak.getUTCFullYear()}-${String(jak.getUTCMonth() + 1).padStart(2, '0')}-${String(jak.getUTCDate()).padStart(2, '0')}`
}

function fmtDate(iso: string): string {
  try {
    const [y, m, d] = iso.split('-').map(Number)
    if (!y || !m || !d) return iso
    return new Date(y, m - 1, d).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
    })
  } catch {
    return iso
  }
}

export default function CashflowEntriesScreen() {
  const today = useMemo(() => new Date(), [])
  const firstOfMonth = useMemo(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
    [today],
  )
  const [from, setFrom] = useState(ymd(firstOfMonth))
  const [to, setTo] = useState(ymd(today))
  const [hidePos, setHidePos] = useState(false)
  const [type, setType] = useState<CashflowKind | undefined>(undefined)
  const query = useCashflowEntries({ from, to, hidePos, type })
  const [editing, setEditing] = useState<CashflowEntry | 'new' | null>(null)
  const remove = useDeleteCashflowEntry()

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Catatan Kas" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (query.error) {
    const isForbidden =
      query.error instanceof ApiError && query.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Catatan Kas" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat catatan kas.'
              : 'Gagal memuat catatan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const items = query.data?.items ?? []
  const totals = query.data?.totals ?? { income: 0, expense: 0, net: 0 }

  function confirmDelete(e: CashflowEntry) {
    Alert.alert(
      'Hapus catatan?',
      'Catatan akan dihapus permanen.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: () =>
            remove.mutate(e.id, {
              onError: (err) =>
                Alert.alert(
                  'Gagal hapus',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            }),
        },
      ],
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Catatan Kas"
        subtitle={`${fmtDate(from)} – ${fmtDate(to)}`}
        back
        right={
          <Pressable
            onPress={() => setEditing('new')}
            style={{
              backgroundColor: COLORS.primary,
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Plus size={14} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={12} color="#fff">
              Catat
            </Paragraph>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Totals card */}
        <YStack
          bg={COLORS.primary}
          br={16}
          p="$4"
          gap="$2"
          style={SHADOWS.card}
        >
          <XStack ai="baseline" jc="space-between">
            <YStack>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color="rgba(255,255,255,0.85)"
              >
                Masuk
              </Paragraph>
              <Money amount={totals.income} color="#fff" fontSize={16} emphasis />
            </YStack>
            <YStack ai="flex-end">
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={11}
                color="rgba(255,255,255,0.85)"
              >
                Keluar
              </Paragraph>
              <Money amount={totals.expense} color="#fff" fontSize={16} emphasis />
            </YStack>
          </XStack>
          <YStack h={1} bg="rgba(255,255,255,0.18)" my={4} />
          <XStack ai="baseline" jc="space-between">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={13}
              color="#fff"
            >
              Net
            </Paragraph>
            <Money amount={totals.net} color="#fff" fontSize={18} emphasis />
          </XStack>
        </YStack>

        {/* Date range inputs */}
        <XStack gap="$2">
          <YStack flex={1} gap="$1">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={COLORS.onSurfaceVariant}
              textTransform="uppercase"
              letterSpacing={0.4}
            >
              Dari
            </Paragraph>
            <TextInput
              value={from}
              onChangeText={setFrom}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
          </YStack>
          <YStack flex={1} gap="$1">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={COLORS.onSurfaceVariant}
              textTransform="uppercase"
              letterSpacing={0.4}
            >
              Sampai
            </Paragraph>
            <TextInput
              value={to}
              onChangeText={setTo}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />
          </YStack>
        </XStack>

        {/* Type chips */}
        <XStack gap="$2">
          {(['all', 'income', 'expense'] as const).map((t) => {
            const key = t === 'all' ? undefined : t
            const on = key === type
            const label = t === 'all' ? 'Semua' : t === 'income' ? 'Masuk' : 'Keluar'
            return (
              <Pressable
                key={t}
                onPress={() => setType(key as CashflowKind | undefined)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: on
                    ? COLORS.primary
                    : COLORS.surfaceContainerLowest,
                  borderWidth: 1,
                  borderColor: on ? COLORS.primary : COLORS.borderSubtle,
                }}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color={on ? '#fff' : COLORS.onSurface}
                >
                  {label}
                </Paragraph>
              </Pressable>
            )
          })}
          <Pressable onPress={() => setHidePos((v) => !v)}>
            <XStack
              ai="center"
              gap={6}
              paddingHorizontal={14}
              paddingVertical={8}
              br={999}
              bg={
                hidePos ? COLORS.warningTint : COLORS.surfaceContainerLowest
              }
              borderWidth={1}
              borderColor={hidePos ? '#92400e' : COLORS.borderSubtle}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={hidePos ? '#92400e' : COLORS.onSurface}
              >
                Sembunyikan POS
              </Paragraph>
            </XStack>
          </Pressable>
        </XStack>

        {items.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <FileText size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada catatan di rentang ini.
            </Paragraph>
          </YStack>
        ) : (
          items.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              onEdit={() => setEditing(e)}
              onDelete={() => confirmDelete(e)}
            />
          ))
        )}
      </ScrollView>

      {editing !== null && (
        <EntryEditorModal
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </YStack>
  )
}

function EntryCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: CashflowEntry
  onEdit: () => void
  onDelete: () => void
}) {
  const amount = Number(entry.amount) || 0
  const isIncome = entry.type === 'income'
  const isManual = entry.source === 'manual'
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={12}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      style={SHADOWS.card}
    >
      <XStack ai="center" gap="$3">
        <YStack
          w={36}
          h={36}
          br={10}
          bg={isIncome ? '#dcfce7' : COLORS.dangerTint}
          ai="center"
          jc="center"
        >
          {isIncome ? (
            <ArrowDownToLine size={16} color={COLORS.success} />
          ) : (
            <ArrowUpFromLine size={16} color={COLORS.danger} />
          )}
        </YStack>
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
            numberOfLines={1}
          >
            {entry.categoryName}
          </Paragraph>
          <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
            {fmtDate(entry.date)} · {entry.accountName}
            {entry.branchName ? ` · ${entry.branchName}` : ''}
          </Stat>
          {entry.note && (
            <Stat fontSize={11} color={COLORS.onSurfaceVariant} numberOfLines={1}>
              {entry.note}
            </Stat>
          )}
        </YStack>
        <YStack ai="flex-end">
          <Paragraph
            fontFamily={FONTS.monoMedium}
            fontSize={14}
            color={isIncome ? COLORS.success : COLORS.danger}
          >
            {isIncome ? '+' : '-'}
            {formatRupiah(amount)}
          </Paragraph>
        </YStack>
      </XStack>
      {isManual ? (
        <XStack ai="center" gap="$2" mt={4}>
          <Pressable
            onPress={onEdit}
            style={{
              flex: 1,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
              backgroundColor: COLORS.surface,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Edit size={12} color={COLORS.onSurface} />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={11}
              color={COLORS.onSurface}
            >
              Edit
            </Paragraph>
          </Pressable>
          <Pressable
            onPress={onDelete}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: COLORS.dangerTint,
              backgroundColor: COLORS.dangerTint,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Trash2 size={12} color={COLORS.danger} />
          </Pressable>
        </XStack>
      ) : (
        <Stat fontSize={10} color={COLORS.outline}>
          Sumber: {entry.source.replace('_', ' ')}
        </Stat>
      )}
    </YStack>
  )
}

function EntryEditorModal({
  editing,
  onClose,
}: {
  editing: CashflowEntry | 'new'
  onClose: () => void
}) {
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const create = useCreateCashflowEntry()
  const update = useUpdateCashflowEntry()
  const cats = useCashflowCategories()
  const accounts = useCashflowAccounts()

  const [type, setType] = useState<CashflowKind>(initial?.type ?? 'expense')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [accountId, setAccountId] = useState(initial?.accountId ?? '')
  const [amount, setAmount] = useState(initial ? String(Number(initial.amount)) : '')
  const [date, setDate] = useState(initial?.date ?? ymd(new Date()))
  const [note, setNote] = useState(initial?.note ?? '')
  const [picker, setPicker] = useState<null | 'category' | 'account'>(null)

  useEffect(() => {
    if (!accountId && accounts.data) {
      const def = accounts.data.find((a) => a.isDefault) ?? accounts.data[0]
      if (def) setAccountId(def.id)
    }
  }, [accountId, accounts.data])

  const filteredCats = (cats.data ?? []).filter((c) => c.kind === type)
  const categoryName = (cats.data ?? []).find((c) => c.id === categoryId)?.name
  const accountName = (accounts.data ?? []).find((a) => a.id === accountId)?.name

  async function handleSave() {
    if (!categoryId) {
      Alert.alert('Kategori wajib', 'Pilih kategori sebelum simpan.')
      return
    }
    const amt = parseRupiah(amount)
    if (amt <= 0) {
      Alert.alert('Jumlah tidak valid', 'Masukkan jumlah > 0.')
      return
    }
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          type,
          categoryId,
          accountId,
          amount: amt,
          date,
          note: note.trim() || null,
        })
      } else {
        await create.mutateAsync({
          type,
          categoryId,
          accountId,
          amount: amt,
          date,
          note: note.trim() || null,
        })
      }
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <YStack flex={1} bg={COLORS.background}>
        <XStack
          ai="center"
          jc="space-between"
          px="$4"
          pt="$5"
          pb="$3"
          borderBottomWidth={1}
          borderBottomColor={COLORS.borderSubtle}
        >
          <H2 fontSize={18} color={COLORS.onSurface}>
            {isNew ? 'Catatan baru' : 'Edit catatan'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
            <XStack gap="$2">
              {(['expense', 'income'] as const).map((k) => {
                const on = k === type
                return (
                  <Pressable
                    key={k}
                    onPress={() => {
                      setType(k)
                      setCategoryId('') // reset since list changes
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor:
                        on
                          ? k === 'income'
                            ? COLORS.success
                            : COLORS.danger
                          : COLORS.borderSubtle,
                      backgroundColor: on
                        ? k === 'income'
                          ? '#dcfce7'
                          : COLORS.dangerTint
                        : COLORS.surfaceContainerLowest,
                      alignItems: 'center',
                    }}
                  >
                    <Paragraph
                      fontFamily={FONTS.bodyBold}
                      fontSize={13}
                      color={
                        on
                          ? k === 'income'
                            ? COLORS.success
                            : COLORS.danger
                          : COLORS.onSurface
                      }
                    >
                      {k === 'income' ? 'Pemasukan' : 'Pengeluaran'}
                    </Paragraph>
                  </Pressable>
                )
              })}
            </XStack>

            <FieldLabel>Kategori</FieldLabel>
            <Pressable onPress={() => setPicker('category')}>
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surfaceContainerLowest}
                br={10}
                px="$3"
                py="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={categoryName ? COLORS.onSurface : COLORS.outline}
                >
                  {categoryName ?? 'Pilih kategori'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>

            <FieldLabel>Akun</FieldLabel>
            <Pressable onPress={() => setPicker('account')}>
              <XStack
                ai="center"
                jc="space-between"
                bg={COLORS.surfaceContainerLowest}
                br={10}
                px="$3"
                py="$3"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <Paragraph
                  fontFamily={FONTS.bodyMedium}
                  fontSize={14}
                  color={accountName ? COLORS.onSurface : COLORS.outline}
                >
                  {accountName ?? 'Pilih akun'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>

            <FieldLabel>Jumlah</FieldLabel>
            <CurrencyInput value={amount} onChange={setAmount} />

            <FieldLabel>Tanggal</FieldLabel>
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />

            <FieldLabel>Catatan (opsional)</FieldLabel>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Mis. Beli alat tulis"
              placeholderTextColor={COLORS.outline}
              maxLength={500}
              style={inputStyle}
            />

            <Pressable
              onPress={handleSave}
              disabled={create.isPending || update.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor:
                  create.isPending || update.isPending
                    ? COLORS.outline
                    : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {create.isPending || update.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {picker === 'category' && (
          <PickList
            title={`Pilih kategori ${type === 'income' ? 'pemasukan' : 'pengeluaran'}`}
            items={filteredCats.map((c) => ({ key: c.id, label: c.name }))}
            selectedKey={categoryId}
            onClose={() => setPicker(null)}
            onSelect={(id) => {
              setCategoryId(id)
              setPicker(null)
            }}
          />
        )}
        {picker === 'account' && (
          <PickList
            title="Pilih akun"
            items={(accounts.data ?? []).map((a) => ({ key: a.id, label: a.name }))}
            selectedKey={accountId}
            onClose={() => setPicker(null)}
            onSelect={(id) => {
              setAccountId(id)
              setPicker(null)
            }}
          />
        )}
      </YStack>
    </Modal>
  )
}

function PickList({
  title,
  items,
  selectedKey,
  onClose,
  onSelect,
}: {
  title: string
  items: Array<{ key: string; label: string }>
  selectedKey: string
  onClose: () => void
  onSelect: (key: string) => void
}) {
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <YStack flex={1} bg={COLORS.background}>
        <XStack
          ai="center"
          jc="space-between"
          px="$4"
          pt="$5"
          pb="$3"
          borderBottomWidth={1}
          borderBottomColor={COLORS.borderSubtle}
        >
          <H2 fontSize={18} color={COLORS.onSurface}>
            {title}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {items.length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
              ta="center"
              py="$6"
            >
              Tidak ada pilihan.
            </Paragraph>
          ) : (
            items.map((it) => {
              const on = it.key === selectedKey
              return (
                <Pressable key={it.key} onPress={() => onSelect(it.key)}>
                  <XStack
                    ai="center"
                    jc="space-between"
                    p="$3"
                    br={10}
                    bg={
                      on
                        ? COLORS.primaryFixed
                        : COLORS.surfaceContainerLowest
                    }
                    borderWidth={1}
                    borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                  >
                    <Paragraph
                      fontFamily={FONTS.bodyMedium}
                      fontSize={14}
                      color={COLORS.onSurface}
                    >
                      {it.label}
                    </Paragraph>
                    {on && <Check size={16} color={COLORS.primary} />}
                  </XStack>
                </Pressable>
              )
            })
          )}
        </ScrollView>
      </YStack>
    </Modal>
  )
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={12}
      color={COLORS.onSurface}
      textTransform="uppercase"
      letterSpacing={0.4}
    >
      {children}
    </Paragraph>
  )
}

function CurrencyInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const display =
    value === '' ? '' : formatRupiah(parseRupiah(value)).replace('Rp ', '')
  return (
    <XStack
      ai="center"
      bg={COLORS.surfaceContainerLowest}
      br={10}
      px="$3"
      h={44}
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      gap="$2"
    >
      <Paragraph
        fontFamily={FONTS.bodyMedium}
        fontSize={14}
        color={COLORS.onSurfaceVariant}
      >
        Rp
      </Paragraph>
      <TextInput
        value={display}
        onChangeText={(v) => onChange(String(parseRupiah(v)))}
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor={COLORS.outline}
        style={{
          flex: 1,
          fontFamily: FONTS.monoMedium,
          fontSize: 14,
          color: COLORS.onSurface,
          paddingVertical: 0,
        }}
      />
    </XStack>
  )
}

const inputStyle = {
  backgroundColor: COLORS.surfaceContainerLowest,
  borderRadius: 10,
  paddingHorizontal: 14,
  height: 44,
  borderWidth: 1,
  borderColor: COLORS.borderSubtle,
  fontFamily: FONTS.body,
  fontSize: 14,
  color: COLORS.onSurface,
}
