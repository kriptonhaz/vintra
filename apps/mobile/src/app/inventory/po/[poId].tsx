/**
 * PO detail — header + lines + status actions.
 *
 * Status flow:
 *   draft → sent (via send button)
 *   sent / partial → received (via receive modal w/ qty per line)
 *   draft / sent → cancelled (with optional reason)
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
import { useLocalSearchParams } from 'expo-router'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Money, Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpFromLine,
  ChevronRight,
  Send,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useCancelPO,
  usePurchaseOrder,
  useReceivePO,
  useSendPO,
  type POLine,
  type PurchaseOrderDetail,
} from '~/lib/inventory'
import { ApiError } from '~/lib/api'
import { formatRupiah } from '~/lib/currency'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

const STATUS_COLOR: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: COLORS.surfaceContainerLow, fg: COLORS.onSurfaceVariant, label: 'Draft' },
  sent: { bg: '#dbeafe', fg: '#2563eb', label: 'Dikirim' },
  partial: { bg: COLORS.warningTint, fg: '#92400e', label: 'Sebagian' },
  received: { bg: COLORS.successTint, fg: COLORS.success, label: 'Selesai' },
  cancelled: { bg: COLORS.dangerTint, fg: COLORS.danger, label: 'Batal' },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export default function PODetailScreen() {
  const { poId } = useLocalSearchParams<{ poId: string }>()
  const query = usePurchaseOrder(poId)
  const sendPo = useSendPO()
  const cancelPo = useCancelPO()
  const [receiveOpen, setReceiveOpen] = useState(false)

  const po = query.data

  if (query.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Detail PO" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (query.error || !po) {
    const isForbidden =
      query.error instanceof ApiError && query.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="Detail PO" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke PO ini.'
              : 'PO tidak ditemukan.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  const status = STATUS_COLOR[po.status] ?? {
    bg: COLORS.surfaceContainerLow,
    fg: COLORS.onSurfaceVariant,
    label: po.status,
  }
  const canSend = po.status === 'draft'
  const canCancel = po.status === 'draft' || po.status === 'sent'
  const canReceive = po.status === 'sent' || po.status === 'partial'
  const id = po.id

  function handleSend() {
    Alert.alert(
      'Kirim ke supplier?',
      'PO akan dikunci dari edit. Supplier diasumsikan menerima pesanan.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Kirim',
          onPress: () =>
            sendPo.mutate(id, {
              onError: (err) =>
                Alert.alert(
                  'Gagal kirim',
                  err instanceof Error ? err.message : 'Coba lagi.',
                ),
            }),
        },
      ],
    )
  }

  function handleCancel() {
    Alert.prompt?.(
      'Batalkan PO?',
      'Tulis alasan pembatalan (opsional).',
      (reason?: string) => {
        cancelPo.mutate(
          { id, reason: reason?.trim() || undefined },
          {
            onError: (err) =>
              Alert.alert(
                'Gagal batal',
                err instanceof Error ? err.message : 'Coba lagi.',
              ),
          },
        )
      },
      'plain-text',
    )
    // Android fallback: Alert.prompt isn't available — show a simple confirm.
    if (Platform.OS === 'android') {
      Alert.alert(
        'Batalkan PO?',
        'PO ini akan ditandai cancelled dan tidak bisa diaktifkan kembali.',
        [
          { text: 'Tidak', style: 'cancel' },
          {
            text: 'Batalkan',
            style: 'destructive',
            onPress: () =>
              cancelPo.mutate(
                { id },
                {
                  onError: (err) =>
                    Alert.alert(
                      'Gagal batal',
                      err instanceof Error ? err.message : 'Coba lagi.',
                    ),
                },
              ),
          },
        ],
      )
    }
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title={po.poNumber}
        subtitle={`${po.supplierName} · ${po.branchName}`}
        back
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={query.isFetching}
            onRefresh={() => query.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {/* Status + total card */}
        <YStack
          bg={COLORS.primary}
          br={16}
          p="$4"
          gap="$2"
          style={SHADOWS.card}
        >
          <XStack ai="center" jc="space-between">
            <Paragraph
              fontFamily={FONTS.bodyMedium}
              fontSize={11}
              color="rgba(255,255,255,0.85)"
              letterSpacing={0.4}
            >
              TOTAL
            </Paragraph>
            <YStack px={8} py={3} br={999} bg="rgba(255,255,255,0.18)">
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={10}
                color="#fff"
              >
                {status.label.toUpperCase()}
              </Paragraph>
            </YStack>
          </XStack>
          <Money amount={po.subtotal} color="#fff" fontSize={28} emphasis />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={12}
            color="rgba(255,255,255,0.85)"
          >
            {po.lines.length} item
          </Paragraph>
        </YStack>

        {/* Meta */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$2"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <SectionLabel>RINCIAN</SectionLabel>
          <Row label="Dibuat" value={fmtDate(po.createdAt)} />
          <Row label="Diharap" value={fmtDate(po.expectedAt)} />
          <Row label="Diterima" value={fmtDate(po.receivedAt)} />
          {po.notes && <Row label="Catatan" value={po.notes} />}
        </YStack>

        {/* Lines */}
        <YStack
          bg={COLORS.surfaceContainerLowest}
          br={14}
          p="$3"
          gap="$3"
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          <SectionLabel>{`ITEM (${po.lines.length})`}</SectionLabel>
          {po.lines.map((l) => (
            <LineCard key={l.id} line={l} />
          ))}
        </YStack>

        {/* Actions */}
        {(canSend || canCancel || canReceive) && (
          <YStack gap="$2" mt="$1">
            {canSend && (
              <ActionRow
                label="Kirim ke supplier"
                icon={Send}
                color={COLORS.primary}
                onPress={handleSend}
                busy={sendPo.isPending}
              />
            )}
            {canReceive && (
              <ActionRow
                label="Terima stok"
                icon={ArrowUpFromLine}
                color={COLORS.success}
                onPress={() => setReceiveOpen(true)}
              />
            )}
            {canCancel && (
              <ActionRow
                label="Batalkan PO"
                icon={Trash2}
                color={COLORS.danger}
                onPress={handleCancel}
                busy={cancelPo.isPending}
              />
            )}
          </YStack>
        )}
      </ScrollView>

      <ReceivePOModal
        visible={receiveOpen}
        po={po}
        onClose={() => setReceiveOpen(false)}
      />
    </YStack>
  )
}

function LineCard({ line }: { line: POLine }) {
  const fullReceived = line.receivedQty >= line.orderedQty
  return (
    <YStack gap={4}>
      <XStack ai="flex-start" jc="space-between" gap="$2">
        <YStack flex={1}>
          <Paragraph
            fontFamily={FONTS.bodySemi}
            fontSize={14}
            color={COLORS.onSurface}
          >
            {line.itemName}
          </Paragraph>
          {line.sku && (
            <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
              SKU {line.sku}
            </Stat>
          )}
        </YStack>
        <Money amount={line.subtotal} fontSize={13} emphasis />
      </XStack>
      <XStack ai="center" jc="space-between">
        <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
          {line.orderedQty.toLocaleString('id-ID')} {line.unitLabel} ×{' '}
          {formatRupiah(line.unitCost)}
        </Stat>
        <Stat
          fontSize={11}
          color={fullReceived ? COLORS.success : COLORS.outline}
        >
          Diterima {line.receivedQty.toLocaleString('id-ID')}/
          {line.orderedQty.toLocaleString('id-ID')}
        </Stat>
      </XStack>
    </YStack>
  )
}

function ActionRow({
  label,
  icon: Icon,
  color,
  onPress,
  busy,
}: {
  label: string
  icon: React.ComponentType<{ size?: number; color?: string }>
  color: string
  onPress: () => void
  busy?: boolean
}) {
  return (
    <Pressable onPress={onPress} disabled={busy}>
      <XStack
        ai="center"
        gap="$3"
        bg={COLORS.surfaceContainerLowest}
        br={14}
        p="$3"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        opacity={busy ? 0.5 : 1}
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

function ReceivePOModal({
  visible,
  po,
  onClose,
}: {
  visible: boolean
  po: PurchaseOrderDetail
  onClose: () => void
}) {
  const [received, setReceived] = useState<Record<string, string>>({})
  const receivePo = useReceivePO()

  useEffect(() => {
    if (!visible) return
    const next: Record<string, string> = {}
    for (const l of po.lines) {
      // Pre-fill with the line's ordered qty so the common "received
      // everything" case is one tap. User edits down for partial.
      next[l.id] = String(l.orderedQty)
    }
    setReceived(next)
  }, [visible, po.lines])

  const totalReceived = useMemo(() => {
    return po.lines.reduce((acc, l) => {
      const q = parseFloat(received[l.id] ?? '0') || 0
      return acc + q * l.unitCost
    }, 0)
  }, [received, po.lines])

  async function handleSubmit() {
    const lines = po.lines
      .map((l) => ({
        poItemId: l.id,
        receivedQty: parseFloat(received[l.id] ?? '0') || 0,
      }))
      .filter((l) => l.receivedQty >= 0)
    if (lines.length === 0) {
      Alert.alert('Tidak ada baris', 'Setidaknya 1 baris harus diisi.')
      return
    }
    try {
      await receivePo.mutateAsync({ id: po.id, lines })
      onClose()
    } catch (err) {
      Alert.alert(
        'Gagal terima',
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
            Terima Stok
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}>
            <XStack
              ai="flex-start"
              gap="$2"
              bg={COLORS.warningTint}
              br={10}
              p="$3"
            >
              <AlertCircle size={14} color="#92400e" />
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color="#92400e"
                flex={1}
              >
                Masukkan jumlah TOTAL yang sudah diterima per baris (akan
                menggantikan, bukan menambah). Stok akan otomatis bertambah
                untuk selisih dengan jumlah yang sebelumnya diterima.
              </Paragraph>
            </XStack>

            {po.lines.map((l) => (
              <YStack
                key={l.id}
                bg={COLORS.surfaceContainerLowest}
                br={12}
                p="$3"
                gap="$2"
                borderWidth={1}
                borderColor={COLORS.borderSubtle}
              >
                <Paragraph
                  fontFamily={FONTS.bodySemi}
                  fontSize={13}
                  color={COLORS.onSurface}
                  numberOfLines={1}
                >
                  {l.itemName}
                </Paragraph>
                <Stat fontSize={11} color={COLORS.onSurfaceVariant}>
                  Dipesan {l.orderedQty.toLocaleString('id-ID')} {l.unitLabel} ·
                  Sudah diterima {l.receivedQty.toLocaleString('id-ID')}
                </Stat>
                <XStack
                  ai="center"
                  bg={COLORS.surface}
                  br={10}
                  px="$3"
                  h={44}
                  borderWidth={1}
                  borderColor={COLORS.borderSubtle}
                  gap="$2"
                >
                  <TextInput
                    value={received[l.id] ?? ''}
                    onChangeText={(v) =>
                      setReceived((prev) => ({ ...prev, [l.id]: v }))
                    }
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
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={12}
                    color={COLORS.onSurfaceVariant}
                  >
                    {l.unitLabel}
                  </Paragraph>
                </XStack>
              </YStack>
            ))}

            <XStack
              ai="center"
              jc="space-between"
              bg={COLORS.surfaceContainerLowest}
              br={10}
              p="$3"
              borderWidth={1}
              borderColor={COLORS.borderSubtle}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={14}
                color={COLORS.onSurface}
              >
                Nilai diterima
              </Paragraph>
              <Money amount={totalReceived} fontSize={16} emphasis />
            </XStack>

            <Pressable
              onPress={handleSubmit}
              disabled={receivePo.isPending}
              style={{
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: receivePo.isPending
                  ? COLORS.outline
                  : COLORS.success,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              {receivePo.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={14}
                  color="#fff"
                >
                  Simpan penerimaan
                </Paragraph>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </YStack>
    </Modal>
  )
}

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <XStack ai="center" jc="space-between" gap="$2">
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        color={COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.bodyMedium}
        fontSize={13}
        color={COLORS.onSurface}
      >
        {value}
      </Paragraph>
    </XStack>
  )
}
