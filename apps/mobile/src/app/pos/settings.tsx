/**
 * POS settings — receipt footer, default payment methods, loyalty rates,
 * cash drawer toggle + variance threshold, void categories CRUD.
 *
 * Deferred to web for now: logo upload, per-branch receipt overrides,
 * tax stack editor (taxes shown read-only with hint to use web). Mobile
 * v1 covers the high-traffic edits.
 *
 * Tier gating happens server-side; we render the controls regardless
 * and surface the server error on save if they hit it.
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
  Switch,
  TextInput,
} from 'react-native'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Edit,
  Plus,
  X,
} from '~/lib/icons'
import {
  useCreateVoidCategory,
  usePOSSettings,
  useUpdatePOSCashSettings,
  useUpdatePOSSettings,
  useUpdateVoidCategory,
  useVoidCategories,
  type PosPaymentMethod,
  type VoidCategory,
} from '~/lib/pos'
import { ApiError } from '~/lib/api'
import { formatRupiah, parseRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const PAYMENT_LABELS: Record<PosPaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  ewallet: 'E-Wallet',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  ovo: 'OVO',
}

export default function POSSettingsScreen() {
  const settingsQuery = usePOSSettings()
  const voidCategoriesQuery = useVoidCategories(true)
  const updateSettings = useUpdatePOSSettings()
  const updateCashSettings = useUpdatePOSCashSettings()

  const data = settingsQuery.data
  const settings = data?.settings ?? null
  const allowedMethods = data?.limits.paymentMethods ?? []
  const tier = data?.tier ?? 'free'
  const komplit = tier === 'komplit'

  // Local edit state (initialized from server)
  const [footer, setFooter] = useState('')
  const [methods, setMethods] = useState<PosPaymentMethod[]>([])
  const [loyaltyOn, setLoyaltyOn] = useState(false)
  const [redeemRate, setRedeemRate] = useState('')
  const [earnRate, setEarnRate] = useState('')
  const [cashDrawer, setCashDrawer] = useState(false)
  const [variance, setVariance] = useState('')
  const [editingCategory, setEditingCategory] = useState<
    VoidCategory | 'new' | null
  >(null)

  useEffect(() => {
    if (!settings) return
    setFooter(settings.receiptFooterText ?? '')
    setMethods(settings.defaultPaymentMethods ?? [])
    setLoyaltyOn(settings.loyaltyEnabled)
    setRedeemRate(settings.loyaltyRedeemRate || '10')
    setEarnRate(settings.loyaltyEarnRate || '1')
    setCashDrawer(settings.cashDrawerEnabled)
    setVariance(String(settings.cashVarianceThreshold || 0))
  }, [settings])

  const dirty = useMemo(() => {
    if (!settings) return false
    return (
      footer !== (settings.receiptFooterText ?? '') ||
      methods.join(',') !==
        (settings.defaultPaymentMethods ?? []).join(',') ||
      loyaltyOn !== settings.loyaltyEnabled ||
      redeemRate !== settings.loyaltyRedeemRate ||
      earnRate !== settings.loyaltyEarnRate
    )
  }, [footer, methods, loyaltyOn, redeemRate, earnRate, settings])

  const cashDirty = useMemo(() => {
    if (!settings) return false
    return (
      cashDrawer !== settings.cashDrawerEnabled ||
      Number(variance) !== settings.cashVarianceThreshold
    )
  }, [cashDrawer, variance, settings])

  async function handleSaveCore() {
    try {
      await updateSettings.mutateAsync({
        receiptFooterText: footer || null,
        defaultPaymentMethods: methods,
        loyaltyEnabled: loyaltyOn,
        loyaltyEarnRate: Number(earnRate) || 0,
        loyaltyRedeemRate: Number(redeemRate) || 0,
      })
      Alert.alert('Tersimpan', 'Pengaturan POS berhasil diperbarui.')
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  async function handleSaveCash() {
    try {
      await updateCashSettings.mutateAsync({
        cashDrawerEnabled: cashDrawer,
        cashVarianceThreshold: Math.max(0, Math.floor(Number(variance) || 0)),
      })
      Alert.alert('Tersimpan', 'Pengaturan Peti Kas diperbarui.')
    } catch (err) {
      Alert.alert(
        'Gagal simpan',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  function toggleMethod(m: PosPaymentMethod) {
    setMethods((prev) =>
      prev.includes(m) ? prev.filter((p) => p !== m) : [...prev, m],
    )
  }

  if (settingsQuery.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pengaturan Kasir" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (settingsQuery.error) {
    const err = settingsQuery.error
    const isForbidden = err instanceof ApiError && err.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Pengaturan Kasir" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak bisa edit pengaturan POS.'
              : 'Gagal memuat pengaturan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader title="Pengaturan Kasir" subtitle={`Paket ${tier}`} back />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
          refreshControl={
            <RefreshControl
              refreshing={settingsQuery.isFetching}
              onRefresh={() => settingsQuery.refetch()}
              tintColor={COLORS.primary}
            />
          }
        >
          {/* Receipt footer */}
          <Section title="Footer struk">
            <TextInput
              value={footer}
              onChangeText={setFooter}
              placeholder="Terima kasih atas kunjungan Anda"
              placeholderTextColor={COLORS.outline}
              multiline
              maxLength={200}
              style={{
                backgroundColor: COLORS.surface,
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                minHeight: 70,
                borderWidth: 1,
                borderColor: COLORS.borderSubtle,
                fontFamily: FONTS.body,
                fontSize: 13,
                color: COLORS.onSurface,
                textAlignVertical: 'top',
              }}
            />
          </Section>

          {/* Payment methods */}
          <Section
            title="Metode pembayaran"
            subtitle="Centang metode yang muncul di checkout. Paket kamu menentukan opsi yang tersedia."
          >
            <YStack gap="$2">
              {allowedMethods.map((m) => {
                const on = methods.includes(m)
                return (
                  <Pressable key={m} onPress={() => toggleMethod(m)}>
                    <XStack
                      ai="center"
                      jc="space-between"
                      px="$3"
                      py="$3"
                      br={10}
                      bg={on ? COLORS.primaryFixed : COLORS.surface}
                      borderWidth={1}
                      borderColor={on ? COLORS.primary : COLORS.borderSubtle}
                    >
                      <Paragraph
                        fontFamily={FONTS.bodyMedium}
                        fontSize={14}
                        color={COLORS.onSurface}
                      >
                        {PAYMENT_LABELS[m] ?? m}
                      </Paragraph>
                      {on && <Check size={16} color={COLORS.primary} />}
                    </XStack>
                  </Pressable>
                )
              })}
            </YStack>
          </Section>

          {/* Loyalty (Komplit) */}
          <Section
            title="Loyalti pelanggan"
            subtitle="Beri poin per transaksi yang bisa ditukar diskon."
            disabled={!komplit}
            lockHint={!komplit ? 'Butuh paket Komplit' : undefined}
          >
            <ToggleRow
              label="Aktifkan loyalti"
              value={loyaltyOn}
              onChange={setLoyaltyOn}
              disabled={!komplit}
            />
            {loyaltyOn && komplit && (
              <YStack gap="$3" mt="$2">
                <NumberRow
                  label="Poin per Rp"
                  value={earnRate}
                  onChange={setEarnRate}
                  suffix="poin / Rp 1.000"
                />
                <NumberRow
                  label="Nilai redeem"
                  value={redeemRate}
                  onChange={setRedeemRate}
                  suffix="Rp / poin"
                />
              </YStack>
            )}
          </Section>

          {/* Save core */}
          <Pressable
            onPress={handleSaveCore}
            disabled={!dirty || updateSettings.isPending}
            style={{
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor:
                !dirty || updateSettings.isPending
                  ? COLORS.outline
                  : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {updateSettings.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Paragraph fontFamily={FONTS.bodyBold} fontSize={14} color="#fff">
                {dirty ? 'Simpan perubahan' : 'Tersimpan'}
              </Paragraph>
            )}
          </Pressable>

          {/* Cash drawer (Komplit) */}
          <Section
            title="Peti Kas"
            subtitle="Lacak modal kas + selisih akhir hari."
            disabled={!komplit}
            lockHint={!komplit ? 'Butuh paket Komplit' : undefined}
          >
            <ToggleRow
              label="Aktifkan Peti Kas"
              value={cashDrawer}
              onChange={setCashDrawer}
              disabled={!komplit}
            />
            {cashDrawer && komplit && (
              <YStack gap="$2" mt="$2">
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color={COLORS.onSurface}
                  textTransform="uppercase"
                  letterSpacing={0.4}
                >
                  Ambang selisih
                </Paragraph>
                <CurrencyField value={variance} onChange={setVariance} />
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={11}
                  color={COLORS.onSurfaceVariant}
                >
                  Selisih di atas {formatRupiah(Number(variance) || 0)} akan
                  diberi tanda merah di laporan.
                </Paragraph>
              </YStack>
            )}
            {komplit && (
              <Pressable
                onPress={handleSaveCash}
                disabled={!cashDirty || updateCashSettings.isPending}
                style={{
                  marginTop: 12,
                  paddingVertical: 12,
                  borderRadius: 10,
                  backgroundColor:
                    !cashDirty || updateCashSettings.isPending
                      ? COLORS.outline
                      : COLORS.primary,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                {updateCashSettings.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={13}
                    color="#fff"
                  >
                    {cashDirty ? 'Simpan Peti Kas' : 'Tersimpan'}
                  </Paragraph>
                )}
              </Pressable>
            )}
          </Section>

          {/* Tax stack (read-only) */}
          <Section title="Pajak">
            {(settings?.taxes ?? []).length === 0 ? (
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
              >
                Belum ada pajak diatur. Tambah dari web (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={12}
                  color={COLORS.primary}
                >
                  vintra.my.id/pos/settings
                </Paragraph>
                ) — editor pajak menyusul di mobile.
              </Paragraph>
            ) : (
              (settings?.taxes ?? []).map((t) => (
                <XStack
                  key={t.id}
                  ai="center"
                  jc="space-between"
                  py="$2"
                  borderBottomWidth={1}
                  borderBottomColor={COLORS.borderSubtle}
                >
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={13}
                    color={COLORS.onSurface}
                  >
                    {t.name}
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.monoMedium}
                    fontSize={13}
                    color={
                      t.isActive ? COLORS.onSurface : COLORS.onSurfaceVariant
                    }
                  >
                    {t.ratePct}% {!t.isActive && '· non-aktif'}
                  </Paragraph>
                </XStack>
              ))
            )}
          </Section>

          {/* Void categories */}
          <Section
            title="Kategori Pembatalan"
            subtitle="Daftar alasan pembatalan transaksi."
            right={
              <Pressable
                onPress={() => setEditingCategory('new')}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: COLORS.primaryFixed,
                  borderRadius: 999,
                }}
              >
                <Plus size={12} color={COLORS.primary} />
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={11}
                  color={COLORS.primary}
                >
                  Tambah
                </Paragraph>
              </Pressable>
            }
          >
            {(voidCategoriesQuery.data ?? []).map((c) => (
              <XStack
                key={c.id}
                ai="center"
                jc="space-between"
                py="$2"
                borderBottomWidth={1}
                borderBottomColor={COLORS.borderSubtle}
              >
                <YStack flex={1}>
                  <Paragraph
                    fontFamily={FONTS.bodyMedium}
                    fontSize={13}
                    color={COLORS.onSurface}
                  >
                    {c.label}
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    {c.isSystem ? 'Bawaan sistem' : 'Kustom'}
                    {!c.isActive && ' · arsip'}
                  </Paragraph>
                </YStack>
                {!c.isSystem && (
                  <Pressable
                    onPress={() => setEditingCategory(c)}
                    hitSlop={8}
                    style={{ padding: 6 }}
                  >
                    <Edit size={16} color={COLORS.outline} />
                  </Pressable>
                )}
              </XStack>
            ))}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>

      <VoidCategoryModal
        editing={editingCategory}
        onClose={() => setEditingCategory(null)}
      />
    </YStack>
  )
}

// ─── Building blocks ───────────────────────────────────────────────

function Section({
  title,
  subtitle,
  children,
  disabled,
  lockHint,
  right,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  disabled?: boolean
  lockHint?: string
  right?: React.ReactNode
}) {
  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      br={14}
      p="$3"
      gap="$3"
      borderWidth={1}
      borderColor={COLORS.borderSubtle}
      opacity={disabled ? 0.6 : 1}
      style={SHADOWS.card}
    >
      <XStack ai="flex-start" jc="space-between" gap="$2">
        <YStack flex={1} gap={2}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={13}
            color={COLORS.onSurface}
          >
            {title}
          </Paragraph>
          {subtitle && (
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={11}
              color={COLORS.onSurfaceVariant}
            >
              {subtitle}
            </Paragraph>
          )}
          {lockHint && (
            <XStack ai="center" gap={4} mt={2}>
              <AlertCircle size={12} color="#92400e" />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color="#92400e"
              >
                {lockHint}
              </Paragraph>
            </XStack>
          )}
        </YStack>
        {right}
      </XStack>
      {children}
    </YStack>
  )
}

function ToggleRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <XStack ai="center" jc="space-between">
      <Paragraph
        fontFamily={FONTS.bodyMedium}
        fontSize={14}
        color={COLORS.onSurface}
      >
        {label}
      </Paragraph>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: COLORS.outline, true: COLORS.primary }}
        thumbColor="#fff"
      />
    </XStack>
  )
}

function NumberRow({
  label,
  value,
  onChange,
  suffix,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  suffix?: string
}) {
  return (
    <YStack gap="$1">
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={12}
        color={COLORS.onSurface}
        textTransform="uppercase"
        letterSpacing={0.4}
      >
        {label}
      </Paragraph>
      <XStack
        ai="center"
        bg={COLORS.surface}
        br={10}
        px="$3"
        h={40}
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        gap="$2"
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
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
        {suffix && (
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            {suffix}
          </Paragraph>
        )}
      </XStack>
    </YStack>
  )
}

function CurrencyField({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const display = value === '' ? '' : formatRupiah(parseRupiah(value)).replace('Rp ', '')
  return (
    <XStack
      ai="center"
      bg={COLORS.surface}
      br={10}
      px="$3"
      h={40}
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

function VoidCategoryModal({
  editing,
  onClose,
}: {
  editing: VoidCategory | 'new' | null
  onClose: () => void
}) {
  const visible = editing !== null
  const isNew = editing === 'new'
  const initial = isNew ? null : editing
  const [label, setLabel] = useState('')
  const [isActive, setIsActive] = useState(true)
  const createCategory = useCreateVoidCategory()
  const updateCategory = useUpdateVoidCategory()

  useEffect(() => {
    if (!visible) return
    if (initial) {
      setLabel(initial.label)
      setIsActive(initial.isActive)
    } else {
      setLabel('')
      setIsActive(true)
    }
  }, [visible, initial])

  async function handleSave() {
    if (!label.trim()) {
      Alert.alert('Wajib diisi', 'Nama kategori tidak boleh kosong.')
      return
    }
    try {
      if (initial) {
        await updateCategory.mutateAsync({
          id: initial.id,
          label: label.trim(),
          isActive,
        })
      } else {
        await createCategory.mutateAsync({ label: label.trim() })
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
      visible={visible}
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
            {isNew ? 'Kategori baru' : 'Edit kategori'}
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <YStack gap="$2">
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={12}
              color={COLORS.onSurface}
              textTransform="uppercase"
              letterSpacing={0.4}
            >
              Nama kategori
            </Paragraph>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Mis. Pelanggan batal"
              placeholderTextColor={COLORS.outline}
              maxLength={50}
              style={{
                backgroundColor: COLORS.surfaceContainerLowest,
                borderRadius: 10,
                paddingHorizontal: 12,
                height: 44,
                borderWidth: 1,
                borderColor: COLORS.borderSubtle,
                fontFamily: FONTS.body,
                fontSize: 14,
                color: COLORS.onSurface,
              }}
            />
          </YStack>

          {!isNew && (
            <ToggleRow
              label="Aktif"
              value={isActive}
              onChange={setIsActive}
            />
          )}

          <Pressable
            onPress={handleSave}
            disabled={createCategory.isPending || updateCategory.isPending}
            style={{
              marginTop: 8,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor:
                createCategory.isPending || updateCategory.isPending
                  ? COLORS.outline
                  : COLORS.primary,
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {createCategory.isPending || updateCategory.isPending ? (
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
      </YStack>
    </Modal>
  )
}

