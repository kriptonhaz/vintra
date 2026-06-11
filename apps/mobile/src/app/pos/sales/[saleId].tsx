/**
 * Sale detail — single transaction view.
 *
 *   • Shows sale number, branch, date, status (voided badge if so)
 *   • Line items w/ qty/unit/subtotal
 *   • Discount + tax + total breakdown
 *   • Payment method + paid + change
 *   • Customer block (when attached)
 *   • Actions: WhatsApp share, PDF share, Void (if today + has permission)
 *
 * Wires to existing mobile getSaleReceiptPDF (already in `useReceiptPdf`)
 * and a new voidSale mutation. Void requires a category id from
 * listVoidCategories + a free-text reason.
 */
import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronRight,
  Download,
  MessageCircle,
  Phone,
  Trash2,
  User,
  X,
} from '~/lib/icons'
import {
  useReceiptPdf,
  useSaleDetail,
  useVoidCategories,
  useVoidSale,
  type PosPaymentMethod,
} from '~/lib/pos'
import { useTenant } from '~/lib/tenant-context'
import { ApiError } from '~/lib/api'
import { formatRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const PAYMENT_LABEL: Record<PosPaymentMethod, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  transfer: 'Transfer',
  card: 'Kartu',
  ewallet: 'E-Wallet',
  gopay: 'GoPay',
  shopeepay: 'ShopeePay',
  ovo: 'OVO',
}

function jakartaYmd(d: Date): string {
  // Jakarta is UTC+7 — convert to a YYYY-MM-DD key.
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60_000
  const jak = new Date(utcMs + 7 * 60 * 60_000)
  const y = jak.getUTCFullYear()
  const m = String(jak.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jak.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function SaleDetailScreen() {
  const router = useRouter()
  const { saleId } = useLocalSearchParams<{ saleId: string }>()
  const saleQuery = useSaleDetail(saleId)
  const receiptPdf = useReceiptPdf()
  const { hasPermission, state: tenantState } = useTenant()
  const businessName =
    tenantState.status === 'ready' ? tenantState.tenant.businessName : 'Toko'

  const [voidOpen, setVoidOpen] = useState(false)
  const [sharing, setSharing] = useState(false)

  const sale = saleQuery.data

  const isToday = useMemo(() => {
    if (!sale) return false
    return jakartaYmd(new Date(sale.createdAt)) === jakartaYmd(new Date())
  }, [sale])

  const canVoid =
    !!sale &&
    sale.status !== 'voided' &&
    isToday &&
    hasPermission('pos.sale.void')

  // ── Loading / error ───────────────────────────────────────────────
  if (saleQuery.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Detail Penjualan" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (saleQuery.error || !sale) {
    const err = saleQuery.error
    const isForbidden = err instanceof ApiError && err.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Detail Penjualan" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke detail penjualan.'
              : 'Penjualan tidak ditemukan atau gagal dimuat.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  // ── Share helpers ─────────────────────────────────────────────────
  async function handleWhatsappShare() {
    if (!sale) return
    const customerPhone = (sale.customerPhone ?? '').replace(/\D/g, '')
    const lines = [
      `*${businessName}*`,
      `Struk #${sale.saleNumber}`,
      `Tanggal: ${formatDateTime(sale.createdAt)}`,
      ...sale.items.map(
        (it) =>
          `${it.productName} ${parseFloat(it.qty) || 0}${it.unitLabel} = ${formatRupiah(Number(it.lineTotal) || 0)}`,
      ),
      '',
      `Total: ${formatRupiah(Number(sale.total) || 0)}`,
      `Bayar (${PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod}): ${formatRupiah(Number(sale.paidAmount) || 0)}`,
      Number(sale.changeAmount) > 0
        ? `Kembalian: ${formatRupiah(Number(sale.changeAmount))}`
        : '',
      '',
      'Terima kasih atas pembelian Anda!',
    ].filter(Boolean)
    const target = customerPhone ? `${customerPhone}` : ''
    const url = `https://wa.me/${target}?text=${encodeURIComponent(lines.join('\n'))}`
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Gagal buka WhatsApp', 'WhatsApp tidak terinstall di HP ini.')
    }
  }

  async function handlePdfShare() {
    if (sharing || !sale) return
    setSharing(true)
    try {
      const { dataUrl, fileName } = await receiptPdf.mutateAsync(sale.id)
      const base64 = dataUrl.replace(/^data:application\/pdf;base64,/, '')
      const path = FileSystem.cacheDirectory + fileName
      await FileSystem.writeAsStringAsync(path, base64, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const ok = await Sharing.isAvailableAsync()
      if (!ok) {
        Alert.alert(
          'Tidak bisa share file',
          'HP ini tidak punya aplikasi yang bisa menerima file PDF.',
        )
        return
      }
      await Sharing.shareAsync(path, {
        mimeType: 'application/pdf',
        dialogTitle: 'Bagikan struk',
        UTI: 'com.adobe.pdf',
      })
    } catch (err) {
      Alert.alert(
        'Gagal share PDF',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    } finally {
      setSharing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────
  const subtotal = Number(sale.subtotal) || 0
  const discount = Number(sale.discountAmount) || 0
  const tax = Number(sale.taxAmount) || 0
  const total = Number(sale.total) || 0
  const paid = Number(sale.paidAmount) || 0
  const change = Number(sale.changeAmount) || 0
  const voided = sale.status === 'voided'

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title={`#${sale.saleNumber}`}
        subtitle={`${formatDateTime(sale.createdAt)} · ${sale.branchName}`}
        back
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={saleQuery.isFetching}
            onRefresh={() => saleQuery.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {voided && (
          <XStack
            ai="flex-start"
            gap="$2"
            bg={COLORS.dangerTint}
            br={12}
            p="$3"
            borderWidth={1}
            borderColor={COLORS.danger}
          >
            <AlertCircle size={18} color={COLORS.danger} />
            <YStack flex={1} gap={2}>
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.danger}
              >
                Transaksi Dibatalkan
              </Paragraph>
              {sale.voidReason ? (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color={COLORS.danger}
                >
                  Alasan: {sale.voidReason}
                </Paragraph>
              ) : null}
            </YStack>
          </XStack>
        )}

        {/* Total card */}
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
            TOTAL
          </Paragraph>
          <Money amount={total} color="#fff" fontSize={28} emphasis />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color="rgba(255,255,255,0.85)"
          >
            {sale.items.length} item ·{' '}
            {PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod}
          </Paragraph>
        </YStack>

        {/* Items */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$3"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <SectionLabel>{`ITEM (${sale.items.length})`}</SectionLabel>
          {sale.items.map((it) => {
            const qty = parseFloat(it.qty) || 0
            const unitPrice = Number(it.unitPrice) || 0
            const lineTotal = Number(it.lineTotal) || 0
            return (
              <YStack key={it.id} gap={2}>
                <XStack ai="flex-start" jc="space-between" gap="$2">
                  <YStack flex={1}>
                    <Paragraph
                      fontFamily={FONTS.bodySemi}
                      fontSize={14}
                      color={COLORS.onSurface}
                    >
                      {it.productName}
                    </Paragraph>
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      {qty} {it.unitLabel} × {formatRupiah(unitPrice)}
                    </Stat>
                    {it.notes ? (
                      <Paragraph
                        fontFamily={FONTS.body}
                        fontSize={11}
                        color={COLORS.onSurfaceVariant}
                      >
                        Catatan: {it.notes}
                      </Paragraph>
                    ) : null}
                  </YStack>
                  <Money amount={lineTotal} fontSize={13} emphasis />
                </XStack>
              </YStack>
            )
          })}
        </YStack>

        {/* Totals breakdown */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$2"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <SectionLabel>RINCIAN</SectionLabel>
          <SummaryRow label="Subtotal" value={formatRupiah(subtotal)} />
          {discount > 0 && (
            <SummaryRow
              label={
                sale.discountType === 'percent'
                  ? `Diskon ${Number(sale.discountValue ?? 0)}%`
                  : 'Diskon'
              }
              value={`-${formatRupiah(discount)}`}
            />
          )}
          {tax > 0 && <SummaryRow label="Pajak" value={formatRupiah(tax)} />}
          <YStack h={1} bg={COLORS.borderSubtle} my="$1" />
          <SummaryRow label="TOTAL" value={formatRupiah(total)} bold />
          <SummaryRow
            label={`Bayar (${PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod})`}
            value={formatRupiah(paid)}
          />
          {change > 0 && (
            <SummaryRow label="Kembalian" value={formatRupiah(change)} />
          )}
        </YStack>

        {/* Customer */}
        {(sale.customerName || sale.customerPhone) && (
          <YStack
            bg={COLORS.surfaceContainerLowest}
            br={14}
            p="$3"
            gap="$2"
            borderWidth={1}
            borderColor={COLORS.borderSubtle}
          >
            <SectionLabel>PELANGGAN</SectionLabel>
            <XStack ai="center" gap="$3">
              <YStack
                w={40}
                h={40}
                br={12}
                bg={COLORS.primaryFixed}
                ai="center"
                jc="center"
              >
                <User size={18} color={COLORS.primary} />
              </YStack>
              <YStack flex={1}>
                <Paragraph
                  fontFamily={FONTS.bodySemi}
                  fontSize={14}
                  color={COLORS.onSurface}
                >
                  {sale.customerName ?? '-'}
                </Paragraph>
                {sale.customerPhone ? (
                  <XStack ai="center" gap={4}>
                    <Phone size={11} color={COLORS.onSurfaceVariant} />
                    <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                      {sale.customerPhone}
                    </Stat>
                  </XStack>
                ) : null}
              </YStack>
            </XStack>
          </YStack>
        )}

        {/* Actions */}
        <YStack gap="$2" mt="$1">
          <ActionRow
            label="Kirim via WhatsApp"
            icon={MessageCircle}
            color="#25D366"
            onPress={handleWhatsappShare}
          />
          <ActionRow
            label={sharing ? 'Menyiapkan PDF…' : 'Unduh / Bagikan PDF'}
            icon={Download}
            color={COLORS.primary}
            onPress={handlePdfShare}
            disabled={sharing}
            busy={sharing}
          />
          {canVoid && (
            <ActionRow
              label="Batalkan transaksi"
              icon={Trash2}
              color={COLORS.danger}
              onPress={() => setVoidOpen(true)}
            />
          )}
        </YStack>
      </ScrollView>

      <VoidSaleModal
        visible={voidOpen}
        saleId={sale.id}
        onClose={() => setVoidOpen(false)}
        onVoided={() => {
          setVoidOpen(false)
          // Stay on the screen; refetch shows the voided banner.
          void saleQuery.refetch()
        }}
      />
    </YStack>
  )
}

// ─── Subcomponents ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={11}
      color={COLORS.onSurfaceVariant}
      letterSpacing={0.55}
    >
      {children}
    </Paragraph>
  )
}

function SummaryRow({
  label,
  value,
  bold,
}: {
  label: string
  value: string
  bold?: boolean
}) {
  return (
    <XStack ai="center" jc="space-between">
      <Paragraph
        fontFamily={bold ? FONTS.bodyBold : FONTS.body}
        fontSize={13}
        color={bold ? COLORS.onSurface : COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={bold ? FONTS.monoMedium : FONTS.mono}
        fontSize={bold ? 14 : 13}
        color={COLORS.onSurface}
      >
        {value}
      </Paragraph>
    </XStack>
  )
}

interface ActionRowProps {
  label: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  color: string
  onPress: () => void
  disabled?: boolean
  busy?: boolean
}

function ActionRow({
  label,
  icon: Icon,
  color,
  onPress,
  disabled,
  busy,
}: ActionRowProps) {
  return (
    <Pressable onPress={onPress} disabled={disabled}>
      <XStack
        ai="center"
        gap="$3"
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        opacity={disabled ? 0.5 : 1}
      >
        <YStack
          w={40}
          h={40}
          br={12}
          ai="center"
          jc="center"
          bg={`${color}22`}
        >
          {busy ? (
            <ActivityIndicator color={color} />
          ) : (
            <Icon size={18} color={color} />
          )}
        </YStack>
        <Paragraph
          flex={1}
          fontFamily={FONTS.bodyBold}
          fontSize={14}
          color={COLORS.onSurface}
        >
          {label}
        </Paragraph>
        <ChevronRight size={18} color={COLORS.outline} />
      </XStack>
    </Pressable>
  )
}

// ─── Void modal ─────────────────────────────────────────────────────

interface VoidSaleModalProps {
  visible: boolean
  saleId: string
  onClose: () => void
  onVoided: () => void
}

function VoidSaleModal({
  visible,
  saleId,
  onClose,
  onVoided,
}: VoidSaleModalProps) {
  const [categoryId, setCategoryId] = useState('')
  const [reason, setReason] = useState('')
  const categoriesQuery = useVoidCategories(visible)
  const voidSale = useVoidSale()

  const categories = (categoriesQuery.data ?? []).filter((c) => c.isActive)

  async function handleSubmit() {
    if (!categoryId) {
      Alert.alert('Pilih kategori', 'Kategori pembatalan wajib dipilih.')
      return
    }
    if (!reason.trim()) {
      Alert.alert('Tulis alasan', 'Alasan pembatalan wajib diisi.')
      return
    }
    try {
      await voidSale.mutateAsync({
        id: saleId,
        reason: reason.trim(),
        categoryId,
      })
      // Reset + close
      setCategoryId('')
      setReason('')
      onVoided()
    } catch (err) {
      Alert.alert(
        'Gagal membatalkan',
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
            Batalkan Transaksi
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 80 }}
          >
            <XStack
              gap="$2"
              ai="flex-start"
              bg={COLORS.warningTint}
              br={12}
              p="$3"
            >
              <AlertCircle size={16} color="#92400e" />
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color="#92400e"
                flex={1}
              >
                Pembatalan tidak bisa dikembalikan. Stok + poin loyalti
                akan dikembalikan otomatis.
              </Paragraph>
            </XStack>

            <YStack gap="$2">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
                textTransform="uppercase"
                letterSpacing={0.4}
              >
                Kategori *
              </Paragraph>
              {categoriesQuery.isLoading ? (
                <ActivityIndicator color={COLORS.primary} />
              ) : categories.length === 0 ? (
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={12}
                  color={COLORS.onSurfaceVariant}
                >
                  Belum ada kategori pembatalan. Tambah di Pengaturan POS.
                </Paragraph>
              ) : (
                categories.map((c) => {
                  const selected = c.id === categoryId
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => setCategoryId(c.id)}
                    >
                      <XStack
                        ai="center"
                        jc="space-between"
                        px="$3"
                        py="$3"
                        br={12}
                        bg={
                          selected
                            ? COLORS.primaryFixed
                            : COLORS.surfaceContainerLowest
                        }
                        borderWidth={1}
                        borderColor={
                          selected ? COLORS.primary : COLORS.borderSubtle
                        }
                      >
                        <Paragraph
                          fontFamily={FONTS.bodyMedium}
                          fontSize={14}
                          color={COLORS.onSurface}
                        >
                          {c.label}
                        </Paragraph>
                        {selected && (
                          <Check size={16} color={COLORS.primary} />
                        )}
                      </XStack>
                    </Pressable>
                  )
                })
              )}
            </YStack>

            <YStack gap="$2">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={12}
                color={COLORS.onSurface}
                textTransform="uppercase"
                letterSpacing={0.4}
              >
                Alasan *
              </Paragraph>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Mis. Salah input qty"
                placeholderTextColor={COLORS.outline}
                multiline
                style={{
                  backgroundColor: COLORS.surfaceContainerLowest,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  minHeight: 80,
                  borderWidth: 1,
                  borderColor: COLORS.borderSubtle,
                  fontFamily: FONTS.body,
                  fontSize: 14,
                  color: COLORS.onSurface,
                  textAlignVertical: 'top',
                }}
              />
            </YStack>

            <Pressable
              onPress={handleSubmit}
              disabled={voidSale.isPending}
              style={{
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: voidSale.isPending
                  ? COLORS.outline
                  : COLORS.danger,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {voidSale.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Trash2 size={16} color="#fff" />
                  <Paragraph
                    fontFamily={FONTS.bodyBold}
                    fontSize={14}
                    color="#fff"
                  >
                    Batalkan Transaksi
                  </Paragraph>
                </>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}
