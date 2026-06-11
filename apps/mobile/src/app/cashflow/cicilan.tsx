/**
 * Cicilan (AP) — list payables w/ installments, create new, mark
 * installments paid, mute/unmute reminders.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertTriangle,
  Bell,
  Check,
  ChevronRight,
  Plus,
  Truck,
  X,
} from '~/lib/icons'
import {
  useCicilanSuppliers,
  useCreatePayable,
  useMarkInstallmentPaid,
  usePayables,
  useTogglePayableReminders,
  type CicilanSupplierOption,
  type PayableInstallment,
  type PayableRow,
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

export default function CashflowCicilanScreen() {
  const [showSettled, setShowSettled] = useState(false)
  const query = usePayables({ settled: showSettled })
  const [creating, setCreating] = useState(false)
  const [openRow, setOpenRow] = useState<PayableRow | null>(null)

  const rows = query.data ?? []
  const totals = useMemo(() => {
    const now = new Date()
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const outstanding = rows.reduce((s, r) => s + r.outstanding, 0)
    const dueThisMonth = rows.reduce((s, r) => {
      const dueThisMonthSum = r.installments.reduce((sx, inst) => {
        if (inst.status === 'paid') return sx
        const due = new Date(inst.dueDate)
        return due <= monthEnd ? sx + inst.amount : sx
      }, 0)
      return s + dueThisMonthSum
    }, 0)
    return { outstanding, dueThisMonth }
  }, [rows])

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Cicilan" back />
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
        <ScreenHeader title="Cicilan" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa lihat cicilan.'
              : 'Gagal memuat cicilan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="Cicilan"
        subtitle={`${rows.length} cicilan aktif`}
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
              Baru
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
          gap="$2"
          style={SHADOWS.card}
        >
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={11}
            color="rgba(255,255,255,0.85)"
            letterSpacing={0.4}
          >
            TOTAL UTANG OUTSTANDING
          </Paragraph>
          <Money amount={totals.outstanding} color="#fff" fontSize={24} emphasis />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color="rgba(255,255,255,0.85)"
          >
            Jatuh tempo bulan ini: {formatRupiah(totals.dueThisMonth)}
          </Paragraph>
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
              Tampilkan yang sudah lunas
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
            <Truck size={28} color={COLORS.outline} />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={13}
              color={COLORS.onSurfaceVariant}
            >
              {showSettled
                ? 'Belum ada cicilan yang lunas.'
                : 'Belum ada utang cicilan.'}
            </Paragraph>
          </YStack>
        ) : (
          rows.map((p) => (
            <PayableCard
              key={p.id}
              payable={p}
              onOpen={() => setOpenRow(p)}
            />
          ))
        )}
      </ScrollView>

      {creating && <CreatePayableModal onClose={() => setCreating(false)} />}
      {openRow && (
        <InstallmentsModal payable={openRow} onClose={() => setOpenRow(null)} />
      )}
    </YStack>
  )
}

function PayableCard({
  payable,
  onOpen,
}: {
  payable: PayableRow
  onOpen: () => void
}) {
  const pct =
    payable.totalAmount > 0
      ? (payable.paidAmount / payable.totalAmount) * 100
      : 0
  const nextInst = payable.installments.find((i) => i.status !== 'paid')
  return (
    <Pressable onPress={onOpen}>
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        opacity={payable.isSettled ? 0.7 : 1}
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
              {payable.supplierName}
            </Paragraph>
            {payable.description && (
              <Stat fontSize={11} color={COLORS.onSurfaceVariant} numberOfLines={1}>
                {payable.description}
              </Stat>
            )}
          </YStack>
          <YStack ai="flex-end">
            <Money amount={payable.outstanding} fontSize={14} emphasis />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={10}
              color={COLORS.outline}
            >
              sisa
            </Paragraph>
          </YStack>
        </XStack>

        {payable.totalAmount > 0 && (
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

        <XStack ai="center" jc="space-between">
          <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
            {payable.installments.filter((i) => i.status === 'paid').length}/
            {payable.installments.length} cicilan terbayar
          </Stat>
          {nextInst && (
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              Berikutnya: {fmtDate(nextInst.dueDate)}
            </Stat>
          )}
        </XStack>

        <XStack ai="center" gap="$2">
          {payable.remindersEnabled && (
            <YStack px={8} py={2} br={6} bg={COLORS.primaryFixed}>
              <XStack ai="center" gap={4}>
                <Bell size={10} color={COLORS.primary} />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={10}
                  color={COLORS.primary}
                >
                  PENGINGAT AKTIF
                </Paragraph>
              </XStack>
            </YStack>
          )}
          <ChevronRight size={14} color={COLORS.outline} />
        </XStack>
      </YStack>
    </Pressable>
  )
}

function CreatePayableModal({ onClose }: { onClose: () => void }) {
  const suppliers = useCicilanSuppliers()
  const create = useCreatePayable()
  const [supplier, setSupplier] = useState<CicilanSupplierOption | null>(null)
  const [supplierName, setSupplierName] = useState('')
  const [description, setDescription] = useState('')
  const [total, setTotal] = useState('')
  const [startDate, setStartDate] = useState(todayYmd())
  const [cadence, setCadence] = useState<'one_off' | 'monthly'>('monthly')
  const [installments, setInstallments] = useState('6')
  const [remindersEnabled, setRemindersEnabled] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)

  async function handleSave() {
    const name = supplier?.name ?? supplierName.trim()
    if (!name) {
      Alert.alert('Supplier wajib', 'Pilih supplier atau tulis nama baru.')
      return
    }
    const amt = parseRupiah(total)
    if (amt <= 0) {
      Alert.alert('Jumlah tidak valid', 'Masukkan total utang > 0.')
      return
    }
    const n = cadence === 'one_off' ? 1 : Math.max(1, parseInt(installments, 10) || 0)
    if (n <= 0) {
      Alert.alert('Cicilan tidak valid', 'Jumlah cicilan minimal 1.')
      return
    }
    try {
      await create.mutateAsync({
        supplierId: supplier?.id ?? null,
        supplierName: name,
        description: description.trim() || null,
        totalAmount: amt,
        startDate,
        cadence,
        installmentCount: n,
        remindersEnabled,
      })
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  const perInstallment = (() => {
    const amt = parseRupiah(total)
    const n = cadence === 'one_off' ? 1 : Math.max(1, parseInt(installments, 10) || 0)
    return n > 0 ? amt / n : 0
  })()

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
            Cicilan baru
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
            <FieldLabel>Supplier</FieldLabel>
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
                  color={supplier ? COLORS.onSurface : COLORS.outline}
                >
                  {supplier?.name ?? 'Pilih dari daftar (opsional)'}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>

            {!supplier && (
              <>
                <FieldLabel>Atau nama supplier baru</FieldLabel>
                <TextInput
                  value={supplierName}
                  onChangeText={setSupplierName}
                  placeholder="Nama supplier"
                  placeholderTextColor={COLORS.outline}
                  style={inputStyle}
                />
              </>
            )}

            <FieldLabel>Deskripsi (opsional)</FieldLabel>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Mis. Mesin kopi"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />

            <FieldLabel>Total utang</FieldLabel>
            <CurrencyInput value={total} onChange={setTotal} />

            <FieldLabel>Cadence</FieldLabel>
            <XStack gap="$2">
              {(['one_off', 'monthly'] as const).map((c) => {
                const on = c === cadence
                return (
                  <Pressable
                    key={c}
                    onPress={() => setCadence(c)}
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: on ? COLORS.primary : COLORS.borderSubtle,
                      backgroundColor: on
                        ? COLORS.primaryFixed
                        : COLORS.surfaceContainerLowest,
                      alignItems: 'center',
                    }}
                  >
                    <Paragraph
                      fontFamily={FONTS.bodyBold}
                      fontSize={13}
                      color={COLORS.onSurface}
                    >
                      {c === 'one_off' ? 'Sekali bayar' : 'Bulanan'}
                    </Paragraph>
                  </Pressable>
                )
              })}
            </XStack>

            {cadence === 'monthly' && (
              <>
                <FieldLabel>Jumlah cicilan</FieldLabel>
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
                  <TextInput
                    value={installments}
                    onChangeText={(v) => setInstallments(v.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    placeholder="6"
                    placeholderTextColor={COLORS.outline}
                    style={{
                      flex: 1,
                      fontFamily: FONTS.monoMedium,
                      fontSize: 14,
                      color: COLORS.onSurface,
                      paddingVertical: 0,
                    }}
                  />
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    bulan
                  </Paragraph>
                </XStack>
              </>
            )}

            <FieldLabel>Mulai (jatuh tempo pertama)</FieldLabel>
            <TextInput
              value={startDate}
              onChangeText={setStartDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={COLORS.outline}
              style={inputStyle}
            />

            <XStack ai="center" jc="space-between">
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Pengingat aktif
              </Paragraph>
              <Switch
                value={remindersEnabled}
                onValueChange={setRemindersEnabled}
                trackColor={{ false: COLORS.outline, true: COLORS.primary }}
                thumbColor="#fff"
              />
            </XStack>

            <YStack
              bg={COLORS.surfaceContainerLowest}
              br={10}
              p="$3"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
              gap="$1"
            >
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
              >
                Per cicilan
              </Paragraph>
              <Money amount={perInstallment} fontSize={18} emphasis />
            </YStack>

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
                  Simpan cicilan
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>

        {pickerOpen && (
          <SupplierPickerModal
            options={suppliers.data ?? []}
            loading={suppliers.isLoading}
            onClose={() => setPickerOpen(false)}
            onSelect={(s) => {
              setSupplier(s)
              setSupplierName('')
              setPickerOpen(false)
            }}
            onClear={() => {
              setSupplier(null)
              setPickerOpen(false)
            }}
          />
        )}
      </YStack>
    </Modal>
  )
}

function SupplierPickerModal({
  options,
  loading,
  onClose,
  onSelect,
  onClear,
}: {
  options: CicilanSupplierOption[]
  loading: boolean
  onClose: () => void
  onSelect: (s: CicilanSupplierOption) => void
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
            Pilih supplier
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
                Supplier baru / tanpa pilih
              </Paragraph>
            </XStack>
          </Pressable>
          {loading && <ActivityIndicator color={COLORS.primary} />}
          {options.map((s) => (
            <Pressable key={s.id} onPress={() => onSelect(s)}>
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
                  {s.name}
                </Paragraph>
                <ChevronRight size={16} color={COLORS.outline} />
              </XStack>
            </Pressable>
          ))}
        </ScrollView>
      </YStack>
    </Modal>
  )
}

function InstallmentsModal({
  payable,
  onClose,
}: {
  payable: PayableRow
  onClose: () => void
}) {
  const markPaid = useMarkInstallmentPaid()
  const toggle = useTogglePayableReminders()

  function handleMarkPaid(inst: PayableInstallment) {
    Alert.alert(
      `Tandai cicilan #${inst.installmentNo} lunas?`,
      `Jumlah ${formatRupiah(inst.amount)} akan dicatat sebagai pengeluaran kas.`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Tandai lunas',
          onPress: () =>
            markPaid.mutate(
              { installmentId: inst.id, paidAt: todayYmd() },
              {
                onError: (err) =>
                  Alert.alert(
                    'Gagal',
                    err instanceof Error ? err.message : 'Coba lagi.',
                  ),
              },
            ),
        },
      ],
    )
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
            {payable.supplierName}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
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
              SISA UTANG
            </Paragraph>
            <Money amount={payable.outstanding} color="#fff" fontSize={24} emphasis />
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color="rgba(255,255,255,0.85)"
            >
              Total {formatRupiah(payable.totalAmount)} · Terbayar{' '}
              {formatRupiah(payable.paidAmount)}
            </Paragraph>
          </YStack>

          <XStack ai="center" jc="space-between">
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={13}
              color={COLORS.onSurface}
            >
              Pengingat
            </Paragraph>
            <Switch
              value={payable.remindersEnabled}
              onValueChange={(v) =>
                toggle.mutate(
                  { payableId: payable.id, enabled: v },
                  {
                    onError: (err) =>
                      Alert.alert(
                        'Gagal',
                        err instanceof Error ? err.message : 'Coba lagi.',
                      ),
                  },
                )
              }
              trackColor={{ false: COLORS.outline, true: COLORS.primary }}
              thumbColor="#fff"
            />
          </XStack>

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
              JADWAL CICILAN
            </Paragraph>
            {payable.installments.map((inst) => (
              <InstallmentRow
                key={inst.id}
                inst={inst}
                onMarkPaid={() => handleMarkPaid(inst)}
                busy={markPaid.isPending}
              />
            ))}
          </YStack>
        </ScrollView>
      </YStack>
    </Modal>
  )
}

function InstallmentRow({
  inst,
  onMarkPaid,
  busy,
}: {
  inst: PayableInstallment
  onMarkPaid: () => void
  busy: boolean
}) {
  const isPaid = inst.status === 'paid'
  const due = new Date(inst.dueDate)
  const isOverdue = !isPaid && due.getTime() < Date.now() - 86_400_000
  return (
    <XStack
      ai="center"
      gap="$3"
      py="$2"
      borderBottomWidth={1}
      borderBottomColor={COLORS.borderSubtle}
    >
      <YStack
        w={28}
        h={28}
        br={14}
        bg={isPaid ? COLORS.success : isOverdue ? COLORS.danger : COLORS.surfaceContainerLow}
        ai="center"
        jc="center"
      >
        <Paragraph
          fontFamily={FONTS.bodyBold}
          fontSize={11}
          color={
            isPaid || isOverdue ? '#fff' : COLORS.onSurfaceVariant
          }
        >
          {inst.installmentNo}
        </Paragraph>
      </YStack>
      <YStack flex={1}>
        <Money amount={inst.amount} fontSize={13} emphasis />
        <Stat
          fontSize={11}
          color={isOverdue ? COLORS.danger : COLORS.onSurfaceVariant}
        >
          {isPaid ? `Lunas ${fmtDate(inst.paidAt)}` : `Jatuh tempo ${fmtDate(inst.dueDate)}`}
        </Stat>
      </YStack>
      {!isPaid && (
        <Pressable
          onPress={onMarkPaid}
          disabled={busy}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 8,
            backgroundColor: busy ? COLORS.outline : COLORS.primary,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <Check size={12} color="#fff" />
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={11} color="#fff">
            Lunas
          </Paragraph>
        </Pressable>
      )}
    </XStack>
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
