/**
 * Akun Kas & Bank — list + CRUD + transfer-between-accounts.
 *
 * Default account is highlighted. Deleting the default is blocked
 * server-side; we surface the error inline.
 */
import { useEffect, useState } from 'react'
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
  Banknote,
  Check,
  ChevronRight,
  CreditCard,
  Edit,
  Plus,
  Trash2,
  Wallet,
  X,
} from '~/lib/icons'
import {
  useCashflowAccounts,
  useCashflowTransfers,
  useCreateCashflowAccount,
  useCreateCashflowTransfer,
  useDeleteCashflowAccount,
  useUpdateCashflowAccount,
  type CashflowAccount,
  type CashflowAccountKind,
} from '~/lib/cashflow'
import { ApiError } from '~/lib/api'
import { formatRupiah, parseRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const KIND_META: Record<
  CashflowAccountKind,
  { label: string; icon: React.ComponentType<{ size?: number; color?: string }>; color: string; tint: string }
> = {
  cash: { label: 'Tunai', icon: Banknote, color: COLORS.success, tint: '#dcfce7' },
  bank: { label: 'Bank', icon: Wallet, color: '#2563eb', tint: '#dbeafe' },
  ewallet: { label: 'E-Wallet', icon: CreditCard, color: '#7c3aed', tint: '#ede9fe' },
  other: { label: 'Lainnya', icon: Wallet, color: COLORS.outline, tint: '#f3f4f6' },
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function CashflowAkunScreen() {
  const accounts = useCashflowAccounts()
  const transfers = useCashflowTransfers()
  const remove = useDeleteCashflowAccount()
  const [editing, setEditing] = useState<CashflowAccount | 'new' | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)

  function confirmDelete(a: CashflowAccount) {
    Alert.alert(
      `Hapus akun "${a.name}"?`,
      a.isDefault
        ? 'Akun default tidak bisa dihapus. Set akun lain sebagai default dulu.'
        : 'Entri yang sudah pakai akun ini akan tetap tercatat di server.',
      [
        { text: 'Batal', style: 'cancel' },
        ...(a.isDefault
          ? []
          : [
              {
                text: 'Hapus',
                style: 'destructive' as const,
                onPress: () =>
                  remove.mutate(a.id, {
                    onError: (err: Error) =>
                      Alert.alert(
                        'Gagal hapus',
                        err.message || 'Coba lagi.',
                      ),
                  }),
              },
            ]),
      ],
    )
  }

  if (accounts.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Akun Kas" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (accounts.error) {
    const isForbidden =
      accounts.error instanceof ApiError && accounts.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Akun Kas" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa edit akun kas.'
              : 'Gagal memuat akun.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const rows = accounts.data ?? []
  const totalBalance = rows
    .filter((a) => a.isActive)
    .reduce((acc, a) => acc + a.balance, 0)

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Akun Kas & Bank"
        subtitle={`${rows.length} akun`}
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
              Baru
            </Paragraph>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={accounts.isFetching || transfers.isFetching}
            onRefresh={() => {
              void accounts.refetch()
              void transfers.refetch()
            }}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Total card */}
        <YStack
          bg={COLORS.primary}
          br={16}
          p="$4"
          gap="$2"
          style={SHADOWS.card}
        >
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={11}
            color="rgba(255,255,255,0.85)"
            letterSpacing={0.4}
          >
            TOTAL SALDO AKUN AKTIF
          </Paragraph>
          <Money amount={totalBalance} color="#fff" fontSize={26} emphasis />
          <Pressable
            onPress={() => {
              if (rows.filter((a) => a.isActive).length < 2) {
                Alert.alert(
                  'Belum cukup',
                  'Butuh minimal 2 akun aktif untuk transfer.',
                )
                return
              }
              setTransferOpen(true)
            }}
            style={{
              marginTop: 8,
              backgroundColor: 'rgba(255,255,255,0.18)',
              paddingVertical: 10,
              borderRadius: 10,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <ArrowDownToLine size={14} color="#fff" />
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={13}
              color="#fff"
            >
              Transfer antar akun
            </Paragraph>
          </Pressable>
        </YStack>

        {rows.length === 0 ? (
          <YStack
            ai="center"
            py="$8"
            gap="$2"
            bg={COLORS.surfaceContainerLowest}
            br={14}
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <Wallet size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada akun kas / bank.
            </Paragraph>
          </YStack>
        ) : (
          rows.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              onEdit={() => setEditing(a)}
              onDelete={() => confirmDelete(a)}
            />
          ))
        )}

        {/* Transfers history */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$2"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
          >
            RIWAYAT TRANSFER
          </Paragraph>
          {(transfers.data ?? []).length === 0 ? (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              Belum ada transfer.
            </Paragraph>
          ) : (
            (transfers.data ?? []).map((t) => (
              <YStack
                key={t.id}
                py="$2"
                borderBottomWidth={1}
                borderBottomColor={COLORS.borderSubtle}
                gap={2}
              >
                <XStack ai="center" jc="space-between">
                  <Paragraph
                    fontFamily={FONTS.bodySemi}
                    fontSize={13}
                    color={COLORS.onSurface}
                    flex={1}
                    numberOfLines={1}
                  >
                    {t.fromName} → {t.toName}
                  </Paragraph>
                  <Money
                    amount={Number(t.amount) || 0}
                    fontSize={13}
                    emphasis
                  />
                </XStack>
                <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                  {fmtDate(t.date)}
                  {t.note ? ` · ${t.note}` : ''}
                </Stat>
              </YStack>
            ))
          )}
        </YStack>
      </ScrollView>

      {editing !== null && (
        <AccountEditorModal
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
      {transferOpen && (
        <TransferModal
          accounts={rows.filter((a) => a.isActive)}
          onClose={() => setTransferOpen(false)}
        />
      )}
    </YStack>
  )
}

// ─── Account card ───────────────────────────────────────────────────

function AccountCard({
  account,
  onEdit,
  onDelete,
}: {
  account: CashflowAccount
  onEdit: () => void
  onDelete: () => void
}) {
  const meta = KIND_META[account.kind] ?? KIND_META.other
  const Icon = meta.icon
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={account.isDefault ? COLORS.primary : COLORS.borderSubtle}
      opacity={account.isActive ? 1 : 0.6}
      style={SHADOWS.card}
    >
      <XStack ai="center" gap="$3">
        <YStack
          w={40}
          h={40}
          br={12}
          bg={meta.tint}
          ai="center"
          jc="center"
        >
          <Icon size={18} color={meta.color} />
        </YStack>
        <YStack flex={1}>
          <XStack ai="center" gap="$2">
            <Paragraph
              fontFamily={FONTS.bodySemi}
              fontSize={14}
              color={COLORS.onSurface}
            >
              {account.name}
            </Paragraph>
            {account.isDefault && (
              <YStack px={6} py={2} br={6} bg={COLORS.primaryFixed}>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={9}
                  color={COLORS.primary}
                >
                  DEFAULT
                </Paragraph>
              </YStack>
            )}
            {!account.isActive && (
              <YStack px={6} py={2} br={6} bg={COLORS.surfaceContainerLow}>
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={9}
                  color={COLORS.onSurfaceVariant}
                >
                  NON-AKTIF
                </Paragraph>
              </YStack>
            )}
          </XStack>
          <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
            {meta.label}
          </Stat>
        </YStack>
        <YStack ai="flex-end">
          <Money amount={account.balance} fontSize={14} emphasis />
        </YStack>
      </XStack>
      <XStack ai="center" gap="$2" mt="$1">
        <Pressable
          onPress={onEdit}
          style={{
            flex: 1,
            paddingVertical: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: COLORS.borderSubtle,
            backgroundColor: COLORS.surface,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Edit size={13} color={COLORS.onSurface} />
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={12}
            color={COLORS.onSurface}
          >
            Edit
          </Paragraph>
        </Pressable>
        {!account.isDefault && (
          <Pressable
            onPress={onDelete}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: COLORS.dangerTint,
              backgroundColor: COLORS.dangerTint,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            <Trash2 size={13} color={COLORS.danger} />
          </Pressable>
        )}
      </XStack>
    </YStack>
  )
}

// ─── Account editor ─────────────────────────────────────────────────

function AccountEditorModal({
  editing,
  onClose,
}: {
  editing: CashflowAccount | 'new'
  onClose: () => void
}) {
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const [name, setName] = useState(initial?.name ?? '')
  const [kind, setKind] = useState<CashflowAccountKind>(initial?.kind ?? 'cash')
  const [opening, setOpening] = useState(
    initial ? String(initial.openingBalance ?? 0) : '0',
  )
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const create = useCreateCashflowAccount()
  const update = useUpdateCashflowAccount()

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Nama wajib', 'Tulis nama akun sebelum simpan.')
      return
    }
    try {
      if (initial) {
        await update.mutateAsync({
          id: initial.id,
          name: name.trim(),
          isActive,
        })
      } else {
        await create.mutateAsync({
          name: name.trim(),
          kind,
          openingBalance: parseRupiah(opening),
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
            {isNew ? 'Akun baru' : 'Edit akun'}
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
            <FieldLabel>Nama</FieldLabel>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Mis. Kas Tunai, BCA"
              placeholderTextColor={COLORS.outline}
              maxLength={60}
              autoFocus={isNew}
              style={inputStyle}
            />

            {isNew && (
              <>
                <FieldLabel>Tipe</FieldLabel>
                <YStack gap="$2">
                  {(Object.keys(KIND_META) as CashflowAccountKind[]).map(
                    (k) => {
                      const on = k === kind
                      const meta = KIND_META[k]
                      const Icon = meta.icon
                      return (
                        <Pressable key={k} onPress={() => setKind(k)}>
                          <XStack
                            ai="center"
                            gap="$3"
                            br={10}
                            p="$3"
                            bg={on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
                            borderWidth={1}
                            borderColor={
                              on ? COLORS.primary : COLORS.borderSubtle
                            }
                          >
                            <Icon size={16} color={meta.color} />
                            <Paragraph
                              fontFamily={FONTS.bodyMedium}
                              fontSize={14}
                              color={COLORS.onSurface}
                              flex={1}
                            >
                              {meta.label}
                            </Paragraph>
                            {on && <Check size={16} color={COLORS.primary} />}
                          </XStack>
                        </Pressable>
                      )
                    },
                  )}
                </YStack>

                <FieldLabel>Saldo Awal</FieldLabel>
                <CurrencyInput value={opening} onChange={setOpening} />
              </>
            )}

            {!isNew && (
              <Pressable onPress={() => setIsActive((v) => !v)}>
                <XStack
                  ai="center"
                  jc="space-between"
                  p="$3"
                  br={10}
                  bg={COLORS.surfaceContainerLowest}
                  borderWidth={1}
                  borderColor={COLORS.borderSubtle}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    Akun aktif
                  </Paragraph>
                  <YStack
                    w={48}
                    h={28}
                    br={999}
                    bg={isActive ? COLORS.primary : COLORS.outline}
                    ai={isActive ? 'flex-end' : 'flex-start'}
                    jc="center"
                    px={2}
                  >
                    <YStack w={24} h={24} br={999} bg="#fff" />
                  </YStack>
                </XStack>
              </Pressable>
            )}

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
      </YStack>
    </Modal>
  )
}

// ─── Transfer modal ─────────────────────────────────────────────────

function TransferModal({
  accounts,
  onClose,
}: {
  accounts: CashflowAccount[]
  onClose: () => void
}) {
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '')
  const [toId, setToId] = useState(accounts[1]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(() => {
    const d = new Date()
    const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
    const jak = new Date(utcMs + 7 * 60 * 60_000)
    const y = jak.getUTCFullYear()
    const m = String(jak.getUTCMonth() + 1).padStart(2, '0')
    const day = String(jak.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  })
  const [picker, setPicker] = useState<null | 'from' | 'to'>(null)
  const create = useCreateCashflowTransfer()

  useEffect(() => {
    if (fromId === toId && accounts.length > 1) {
      const other = accounts.find((a) => a.id !== fromId)
      if (other) setToId(other.id)
    }
  }, [fromId, toId, accounts])

  async function handleSave() {
    const amt = parseRupiah(amount)
    if (amt <= 0) {
      Alert.alert('Jumlah tidak valid', 'Masukkan jumlah > 0.')
      return
    }
    if (fromId === toId) {
      Alert.alert('Akun sama', 'Pilih akun asal & tujuan berbeda.')
      return
    }
    try {
      await create.mutateAsync({
        fromAccountId: fromId,
        toAccountId: toId,
        amount: amt,
        date,
        note: note.trim() || null,
      })
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal transfer',
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
            Transfer antar akun
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
            <FieldLabel>Dari</FieldLabel>
            <AccountPickerButton
              accounts={accounts}
              selectedId={fromId}
              onPick={() => setPicker('from')}
            />

            <YStack ai="center" my="$1">
              <YStack
                w={36}
                h={36}
                br={18}
                bg={COLORS.surfaceContainerLow}
                ai="center"
                jc="center"
              >
                <ArrowUpFromLine size={16} color={COLORS.outline} />
              </YStack>
            </YStack>

            <FieldLabel>Ke</FieldLabel>
            <AccountPickerButton
              accounts={accounts}
              selectedId={toId}
              onPick={() => setPicker('to')}
            />

            <FieldLabel>Jumlah</FieldLabel>
            <CurrencyInput value={amount} onChange={setAmount} />

            <FieldLabel>Tanggal</FieldLabel>
            <TextInput
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.outline}
              maxLength={10}
              style={inputStyle}
            />

            <FieldLabel>Catatan (opsional)</FieldLabel>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Mis. Setor ke bank"
              placeholderTextColor={COLORS.outline}
              maxLength={500}
              style={inputStyle}
            />

            <Pressable
              onPress={handleSave}
              disabled={create.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: create.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {create.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Transfer
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {picker && (
          <PickAccountModal
            accounts={accounts}
            selectedId={picker === 'from' ? fromId : toId}
            onClose={() => setPicker(null)}
            onSelect={(id) => {
              if (picker === 'from') setFromId(id)
              else setToId(id)
              setPicker(null)
            }}
          />
        )}
      </YStack>
    </Modal>
  )
}

function AccountPickerButton({
  accounts,
  selectedId,
  onPick,
}: {
  accounts: CashflowAccount[]
  selectedId: string
  onPick: () => void
}) {
  const a = accounts.find((x) => x.id === selectedId)
  return (
    <Pressable onPress={onPick}>
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
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
          >
            {a?.name ?? '-'}
          </Paragraph>
          {a && (
            <Money
              amount={a.balance}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
            />
          )}
        </YStack>
        <ChevronRight size={16} color={COLORS.outline} />
      </XStack>
    </Pressable>
  )
}

function PickAccountModal({
  accounts,
  selectedId,
  onClose,
  onSelect,
}: {
  accounts: CashflowAccount[]
  selectedId: string
  onClose: () => void
  onSelect: (id: string) => void
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
            Pilih akun
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {accounts.map((a) => {
            const on = a.id === selectedId
            return (
              <Pressable key={a.id} onPress={() => onSelect(a.id)}>
                <XStack
                  ai="center"
                  jc="space-between"
                  p="$3"
                  br={10}
                  bg={on ? COLORS.primaryFixed : COLORS.surfaceContainerLowest}
                  borderWidth={1}
                  borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                >
                  <YStack flex={1}>
                    <Paragraph
                      fontFamily={FONTS.bodyMedium}
                      fontSize={14}
                      color={COLORS.onSurface}
                    >
                      {a.name}
                    </Paragraph>
                    <Money
                      amount={a.balance}
                      fontSize={11}
                      color={COLORS.onSurfaceVariant}
                    />
                  </YStack>
                  {on && <Check size={16} color={COLORS.primary} />}
                </XStack>
              </Pressable>
            )
          })}
        </ScrollView>
      </YStack>
    </Modal>
  )
}

// ─── Shared input bits ──────────────────────────────────────────────

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
