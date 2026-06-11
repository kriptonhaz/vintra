/**
 * Bon Pelanggan (AR) — list receivables w/ aging, filter active/settled,
 * create new bon, record partial/full payment per row.
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
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronRight,
  Phone,
  Plus,
  User,
  X,
} from '~/lib/icons'
import {
  useArCustomerOptions,
  useCreateReceivable,
  useReceivablePayments,
  useReceivables,
  useRecordArPayment,
  type ArCustomerOption,
  type ReceivableRow,
} from '~/lib/cashflow'
import { ApiError } from '~/lib/api'
import { formatRupiah, parseRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

function todayYmd(): string {
  const d = new Date()
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const jak = new Date(utcMs + 7 * 60 * 60_000)
  return `${jak.getUTCFullYear()}-${String(jak.getUTCMonth() + 1).padStart(2, '0')}-${String(jak.getUTCDate()).padStart(2, '0')}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
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

function agingColor(days: number): { bg: string; fg: string; label: string } {
  if (days <= 0) return { bg: '#dcfce7', fg: COLORS.success, label: 'Tepat waktu' }
  if (days <= 30) return { bg: COLORS.warningTint, fg: '#92400e', label: `${days} hari` }
  if (days <= 60) return { bg: '#fed7aa', fg: '#9a3412', label: `${days} hari` }
  return { bg: COLORS.dangerTint, fg: COLORS.danger, label: `${days} hari` }
}

export default function CashflowBonScreen() {
  const [showSettled, setShowSettled] = useState(false)
  const query = useReceivables({ settled: showSettled })
  const [creating, setCreating] = useState(false)
  const [paying, setPaying] = useState<ReceivableRow | null>(null)

  const rows = query.data ?? []
  const totals = useMemo(
    () => ({
      outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
      overdue: rows.filter((r) => r.daysOverdue > 0).length,
    }),
    [rows],
  )

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Bon Pelanggan" back />
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
        <ScreenHeader title="Bon Pelanggan" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat bon pelanggan.'
              : 'Gagal memuat bon.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Bon Pelanggan"
        subtitle={`${rows.length} bon · ${totals.overdue} telat`}
        back
        right={
          <Pressable
            onPress={() => setCreating(true)}
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
              Bon Baru
            </Paragraph>
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        <YStack
          bg={COLORS.primary}
          br={16}
          p="$4"
          gap="$1"
          style={SHADOWS.card}
        >
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={11}
            color="rgba(255,255,255,0.85)"
            letterSpacing={0.4}
          >
            TOTAL PIUTANG
          </Paragraph>
          <Money amount={totals.outstanding} color="#fff" fontSize={24} emphasis />
        </YStack>

        <Pressable onPress={() => setShowSettled((v) => !v)}>
          <XStack ai="center" gap="$2">
            <YStack
              w={20}
              h={20}
              br={6}
              bg={showSettled ? COLORS.primary : COLORS.surface}
              borderWidth={1}
              borderColor={showSettled ? COLORS.primary : COLORS.outline}
              ai="center"
              jc="center"
            >
              {showSettled && <Check size={12} color="#fff" />}
            </YStack>
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={12}
              color={COLORS.onSurface}
            >
              Tampilkan bon yang sudah lunas
            </Paragraph>
          </XStack>
        </Pressable>

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
            <User size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              {showSettled
                ? 'Belum ada bon yang lunas.'
                : 'Belum ada piutang pelanggan.'}
            </Paragraph>
          </YStack>
        ) : (
          rows.map((r) => (
            <ReceivableCard
              key={r.id}
              row={r}
              onPay={() => setPaying(r)}
            />
          ))
        )}
      </ScrollView>

      {creating && (
        <CreateReceivableModal onClose={() => setCreating(false)} />
      )}
      {paying && (
        <RecordPaymentModal
          receivable={paying}
          onClose={() => setPaying(null)}
        />
      )}
    </YStack>
  )
}

function ReceivableCard({
  row,
  onPay,
}: {
  row: ReceivableRow
  onPay: () => void
}) {
  const aging = agingColor(row.daysOverdue)
  const pct = row.totalAmount > 0 ? (row.paidAmount / row.totalAmount) * 100 : 0
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      opacity={row.isSettled ? 0.7 : 1}
      style={SHADOWS.card}
    >
      <XStack ai="center" jc="space-between">
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
            numberOfLines={1}
          >
            {row.customerName}
          </Paragraph>
          {row.customerPhone && (
            <XStack ai="center" gap={4}>
              <Phone size={10} color={COLORS.onSurfaceVariant} />
              <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                {row.customerPhone}
              </Stat>
            </XStack>
          )}
        </YStack>
        <YStack ai="flex-end">
          <Money amount={row.outstanding} fontSize={14} emphasis />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={10}
            color={COLORS.outline}
          >
            sisa
          </Paragraph>
        </YStack>
      </XStack>

      <XStack ai="center" gap="$2">
        {row.dueDate && (
          <YStack px={8} py={2} br={6} bg={aging.bg}>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={10}
              color={aging.fg}
            >
              {aging.label}
            </Paragraph>
          </YStack>
        )}
        <Stat fontSize={11} color={COLORS.onSurfaceVariant} flex={1}>
          {row.dueDate ? `Jatuh tempo ${fmtDate(row.dueDate)}` : 'Tanpa tempo'}
        </Stat>
      </XStack>

      {row.totalAmount > 0 && (
        <YStack
          w="100%"
          h={6}
          br={3}
          bg={COLORS.surfaceContainerLow}
          overflow="hidden"
        >
          <YStack h={6} br={3} bg={COLORS.success} width={`${pct}%`} />
        </YStack>
      )}
      <Stat fontSize={10} color={COLORS.onSurfaceVariant}>
        {formatRupiah(row.paidAmount)} dari {formatRupiah(row.totalAmount)}
      </Stat>

      {!row.isSettled && (
        <Pressable
          onPress={onPay}
          style={{
            marginTop: 6,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: COLORS.primary,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={12} color="#fff">
            Catat pembayaran
          </Paragraph>
        </Pressable>
      )}
    </YStack>
  )
}

function CreateReceivableModal({ onClose }: { onClose: () => void }) {
  const customers = useArCustomerOptions()
  const create = useCreateReceivable()
  const [customer, setCustomer] = useState<ArCustomerOption | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayYmd())
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  async function handleSave() {
    const name = customer?.name ?? customerName.trim()
    if (!name) {
      Alert.alert('Nama wajib', 'Pilih pelanggan atau tulis nama baru.')
      return
    }
    const amt = parseRupiah(amount)
    if (amt <= 0) {
      Alert.alert('Jumlah tidak valid', 'Masukkan jumlah > 0.')
      return
    }
    try {
      await create.mutateAsync({
        customerId: customer?.id ?? null,
        customerName: name,
        customerPhone: customer?.phone ?? customerPhone.trim() ?? null,
        totalAmount: amt,
        date,
        dueDate: dueDate || null,
        note: note.trim() || null,
      })
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
            Bon baru
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
            <FieldLabel>Pelanggan</FieldLabel>
            <Pressable onPress={() => setPickerOpen(true)}>
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
                  color={customer ? COLORS.onSurface : COLORS.outline}
                >
                  {customer?.name ?? 'Pilih dari daftar (opsional)'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>

            {!customer && (
              <>
                <FieldLabel>Atau nama pelanggan baru</FieldLabel>
                <TextInput
                  value={customerName}
                  onChangeText={setCustomerName}
                  placeholder="Nama lengkap"
                  placeholderTextColor={COLORS.outline}
                  style={inputStyle}
                />
                <FieldLabel>Telepon (opsional)</FieldLabel>
                <TextInput
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  placeholder="08xx"
                  placeholderTextColor={COLORS.outline}
                  keyboardType="phone-pad"
                  style={inputStyle}
                />
              </>
            )}

            <FieldLabel>Jumlah utang</FieldLabel>
            <CurrencyInput value={amount} onChange={setAmount} />

            <XStack gap="$2">
              <YStack flex={1} gap="$2">
                <FieldLabel>Tanggal</FieldLabel>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={COLORS.outline}
                  style={inputStyle}
                />
              </YStack>
              <YStack flex={1} gap="$2">
                <FieldLabel>Jatuh tempo</FieldLabel>
                <TextInput
                  value={dueDate}
                  onChangeText={setDueDate}
                  placeholder="opsional"
                  placeholderTextColor={COLORS.outline}
                  style={inputStyle}
                />
              </YStack>
            </XStack>

            <FieldLabel>Catatan (opsional)</FieldLabel>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Mis. Bon makan siang"
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
                  Simpan bon
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {pickerOpen && (
          <CustomerPickerModal
            options={customers.data ?? []}
            loading={customers.isLoading}
            onClose={() => setPickerOpen(false)}
            onSelect={(c) => {
              setCustomer(c)
              setCustomerName('')
              setCustomerPhone('')
              setPickerOpen(false)
            }}
            onClear={() => {
              setCustomer(null)
              setPickerOpen(false)
            }}
          />
        )}
      </YStack>
    </Modal>
  )
}

function CustomerPickerModal({
  options,
  loading,
  onClose,
  onSelect,
  onClear,
}: {
  options: ArCustomerOption[]
  loading: boolean
  onClose: () => void
  onSelect: (c: ArCustomerOption) => void
  onClear: () => void
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
            Pilih pelanggan
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          <Pressable onPress={onClear}>
            <XStack
              ai="center"
              p="$3"
              br={10}
              bg={COLORS.surfaceContainerLowest}
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
              borderStyle="dashed"
              gap="$2"
            >
              <Plus size={14} color={COLORS.primary} />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.primary}
              >
                Pelanggan baru / tanpa pilih
              </Paragraph>
            </XStack>
          </Pressable>
          {loading && <ActivityIndicator color={COLORS.primary} />}
          {options.map((c) => (
            <Pressable key={c.id} onPress={() => onSelect(c)}>
              <XStack
                ai="center"
                jc="space-between"
                p="$3"
                br={10}
                bg={COLORS.surfaceContainerLowest}
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <YStack>
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={14}
                    color={COLORS.onSurface}
                  >
                    {c.name}
                  </Paragraph>
                  {c.phone && (
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      {c.phone}
                    </Stat>
                  )}
                </YStack>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>
          ))}
        </ScrollView>
      </YStack>
    </Modal>
  )
}

function RecordPaymentModal({
  receivable,
  onClose,
}: {
  receivable: ReceivableRow
  onClose: () => void
}) {
  const [amount, setAmount] = useState(String(receivable.outstanding))
  const [date, setDate] = useState(todayYmd())
  const [note, setNote] = useState('')
  const record = useRecordArPayment()
  const payments = useReceivablePayments(receivable.id)

  async function handleSave() {
    const amt = parseRupiah(amount)
    if (amt <= 0) {
      Alert.alert('Jumlah tidak valid', 'Masukkan jumlah > 0.')
      return
    }
    if (amt > receivable.outstanding) {
      Alert.alert(
        'Lebih dari sisa',
        `Sisa hutang hanya ${formatRupiah(receivable.outstanding)}. Kurangi atau setarakan.`,
      )
      return
    }
    try {
      await record.mutateAsync({
        receivableId: receivable.id,
        amount: amt,
        date,
        note: note.trim() || null,
      })
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
            Catat pembayaran
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
            <YStack
              bg={COLORS.primaryFixed}
              br={12}
              p="$3"
              gap={4}
              borderWidth={1}
              borderColor={COLORS.primary}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={11}
                color={COLORS.primary}
                letterSpacing={0.55}
              >
                {receivable.customerName.toUpperCase()}
              </Paragraph>
              <XStack ai="baseline" gap="$2">
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurface}
                >
                  Sisa
                </Paragraph>
                <Money
                  amount={receivable.outstanding}
                  fontSize={18}
                  emphasis
                />
              </XStack>
            </YStack>

            <FieldLabel>Jumlah dibayar</FieldLabel>
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
              placeholder="Mis. Lunas via BCA"
              placeholderTextColor={COLORS.outline}
              maxLength={500}
              style={inputStyle}
            />

            {payments.data && payments.data.length > 0 && (
              <YStack
                bg={COLORS.surfaceContainerLowest}
                br={12}
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
                  RIWAYAT PEMBAYARAN
                </Paragraph>
                {payments.data.map((p) => (
                  <XStack key={p.id} ai="center" jc="space-between">
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      {fmtDate(p.date)}
                      {p.note ? ` · ${p.note}` : ''}
                    </Stat>
                    <Money amount={p.amount} fontSize={12} />
                  </XStack>
                ))}
              </YStack>
            )}

            <Pressable
              onPress={handleSave}
              disabled={record.isPending}
              style={{
                marginTop: 8,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: record.isPending
                  ? COLORS.outline
                  : COLORS.primary,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {record.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan pembayaran
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}

// ─── Shared bits ───────────────────────────────────────────────────

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

// Keep the AlertCircle icon import live for a future "show note" affordance.
const _AlertCircle = AlertCircle
const _useEffect = useEffect
