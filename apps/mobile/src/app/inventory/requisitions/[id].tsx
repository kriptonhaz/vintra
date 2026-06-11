/**
 * Requisition detail screen — full info + lifecycle actions based on
 * status and the user's branch access (the server enforces, but we
 * gate the UI to avoid showing buttons that can't succeed).
 *
 * Lifecycle:
 *
 *      [pending] ──Setujui──▶ [approved] ──Penuhi──▶ [fulfilled]
 *          │                       │
 *          ├──Tolak──▶ [rejected]
 *          └──Batal──▶ [cancelled]
 *
 * Action visibility:
 *   - "Setujui" / "Tolak"  → user has access to sourceBranchId (main branch)
 *     AND status === 'pending'
 *   - "Batal"              → user has access to requestingBranchId
 *     AND status === 'pending'
 *   - "Penuhi"             → user has access to sourceBranchId AND
 *     status === 'approved'  (opens FulfillSheet to set per-line qty)
 *
 * We approximate "user access" via the tenant's role for now — owners
 * see everything; staff don't get the destructive buttons.
 */
import { useState } from 'react'
import { Alert, Pressable, RefreshControl } from 'react-native'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import {
  Button,
  Paragraph,
  ScrollView,
  Sheet,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Package,
  Trash2,
  X,
} from '~/lib/icons'
import {
  useApproveRequisition,
  useCancelRequisition,
  useFulfillRequisition,
  useRejectRequisition,
  useRequisition,
  type RequisitionDetail,
  type RequisitionStatus,
} from '../../../lib/inventory'
import { useTenant } from '../../../lib/tenant-context'
import { Money, Stat } from '../../../components/Money'
import { COLORS, FONTS } from '../../../lib/theme'

const OWNER_ROLES = new Set(['owner', 'admin'])

export default function RequisitionDetailScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const req = useRequisition(id ?? null)
  const tenant = useTenant()

  const approve = useApproveRequisition()
  const reject = useRejectRequisition()
  const cancel = useCancelRequisition()

  const [fulfillOpen, setFulfillOpen] = useState(false)

  const role = tenant.state.status === 'ready' ? tenant.state.tenant.role : ''
  const isOwner = OWNER_ROLES.has(role.toLowerCase())

  const data = req.data

  // Confirm-style handlers — wraps the mutation with a native Alert.
  function withConfirm(
    title: string,
    body: string,
    label: string,
    fn: () => Promise<unknown>,
  ) {
    Alert.alert(title, body, [
      { text: 'Batal', style: 'cancel' },
      {
        text: label,
        onPress: async () => {
          try {
            await fn()
          } catch (e) {
            Alert.alert(
              'Gagal',
              e instanceof Error ? e.message : 'Coba lagi.',
            )
          }
        },
      },
    ])
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <YStack flex={1} bg={COLORS.background}>
        {/* Header */}
        <YStack bg={COLORS.primary} pt={60} pb="$4" px="$5" gap="$2">
          <XStack ai="center" jc="space-between">
            <Pressable onPress={() => router.back()} hitSlop={10}>
              <YStack
                w={36}
                h={36}
                br={18}
                bg={COLORS.primaryFixed}
                ai="center"
                jc="center"
              >
                <ChevronLeft size={22} color={COLORS.primary} />
              </YStack>
            </Pressable>
            {data && <StatusBadgeLarge status={data.status} />}
          </XStack>
          <YStack gap="$0.5">
            <Paragraph
              fontFamily={FONTS.mono}
              fontSize={12}
              color="white"
              opacity={0.85}
            >
              {data?.requisitionNumber ?? '...'}
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.headingBold}
              fontSize={20}
              color="white"
            >
              Mutasi Stok
            </Paragraph>
          </YStack>
        </YStack>

        {req.isLoading ? (
          <YStack flex={1} ai="center" jc="center">
            <Spinner color={COLORS.primary} size="large" />
          </YStack>
        ) : req.error || !data ? (
          <ErrorPanel error={req.error} />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 32 }}
            refreshControl={
              <RefreshControl
                refreshing={req.isFetching}
                onRefresh={() => req.refetch()}
                tintColor={COLORS.primary}
              />
            }
          >
            {/* Branches block */}
            <YStack
              bg={COLORS.surfaceContainerLowest}
              br="$4"
              p="$3.5"
              gap="$2"
              borderWidth={1}
              borderColor={COLORS.outlineVariant}
            >
              <BranchKv label="Dari" name={data.sourceBranchName} />
              <BranchKv label="Ke" name={data.requestingBranchName} />
            </YStack>

            {/* Lines */}
            <SectionTitle label="DAFTAR BARANG" />
            <YStack gap="$2">
              {data.lines.map((l) => (
                <YStack
                  key={l.id}
                  bg={COLORS.surfaceContainerLowest}
                  br="$4"
                  p="$3"
                  gap="$1.5"
                  borderWidth={1}
                  borderColor={COLORS.outlineVariant}
                >
                  <XStack ai="center" gap="$3">
                    <YStack
                      w={36}
                      h={36}
                      br={18}
                      bg={COLORS.surfaceContainerLow}
                      ai="center"
                      jc="center"
                    >
                      <Package size={16} color={COLORS.outline} />
                    </YStack>
                    <YStack flex={1}>
                      <Paragraph
                        fontFamily={FONTS.headingSemi}
                        fontSize={14}
                        color={COLORS.onSurface}
                        numberOfLines={2}
                      >
                        {l.itemName}
                      </Paragraph>
                      <Paragraph
                        fontFamily={FONTS.body}
                        fontSize={11}
                        color={COLORS.onSurfaceVariant}
                      >
                        Diminta {fmtQty(l.requestedQty)} {l.baseUnitLabel}
                        {l.fulfilledQty > 0 &&
                          ` · Dikirim ${fmtQty(l.fulfilledQty)}`}
                      </Paragraph>
                    </YStack>
                    {l.unitPrice != null && (
                      <YStack ai="flex-end">
                        <Money
                          amount={l.unitPrice * l.requestedQty}
                          fontSize={13}
                          emphasis
                          color={COLORS.onSurface}
                        />
                        <Paragraph
                          fontFamily={FONTS.body}
                          fontSize={10}
                          color={COLORS.onSurfaceVariant}
                        >
                          @<Money
                            amount={l.unitPrice}
                            fontSize={10}
                            color={COLORS.onSurfaceVariant}
                          />
                        </Paragraph>
                      </YStack>
                    )}
                  </XStack>
                  {l.notes && (
                    <Paragraph
                      fontFamily={FONTS.body}
                      fontSize={11}
                      color={COLORS.onSurfaceVariant}
                      pl={48}
                    >
                      {l.notes}
                    </Paragraph>
                  )}
                </YStack>
              ))}
            </YStack>

            {/* Total cost (franchise only) */}
            {data.totalCost > 0 && (
              <XStack
                jc="space-between"
                ai="center"
                p="$3"
                bg={COLORS.primaryFixed}
                br="$3"
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={13}
                  color={COLORS.onPrimaryFixed}
                >
                  Total Biaya
                </Paragraph>
                <Money
                  amount={data.totalCost}
                  fontSize={16}
                  emphasis
                  color={COLORS.onPrimaryFixed}
                />
              </XStack>
            )}

            {/* Notes */}
            {data.notes && (
              <>
                <SectionTitle label="CATATAN" />
                <YStack
                  bg={COLORS.surfaceContainerLowest}
                  br="$4"
                  p="$3.5"
                  borderWidth={1}
                  borderColor={COLORS.outlineVariant}
                >
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={13}
                    lineHeight={20}
                    color={COLORS.onSurface}
                  >
                    {data.notes}
                  </Paragraph>
                </YStack>
              </>
            )}

            {/* Timeline */}
            <SectionTitle label="LINIMASA" />
            <YStack gap="$1.5">
              <TimelineRow label="Dibuat" at={data.createdAt} />
              {data.approvedAt && (
                <TimelineRow label="Disetujui" at={data.approvedAt} />
              )}
              {data.fulfilledAt && (
                <TimelineRow label="Terpenuhi" at={data.fulfilledAt} />
              )}
            </YStack>
          </ScrollView>
        )}

        {/* Action bar */}
        {data && (
          <ActionBar
            req={data}
            isOwner={isOwner}
            onApprove={() =>
              withConfirm(
                'Setujui permintaan?',
                'Stok belum dipindah. Anda bisa memenuhi setelahnya.',
                'Setujui',
                () => approve.mutateAsync(data.id),
              )
            }
            onReject={() =>
              withConfirm(
                'Tolak permintaan?',
                'Tindakan ini tidak bisa dibatalkan.',
                'Tolak',
                () => reject.mutateAsync({ id: data.id }),
              )
            }
            onCancel={() =>
              withConfirm(
                'Batalkan permintaan?',
                'Permintaan akan ditandai sebagai dibatalkan.',
                'Batalkan',
                () => cancel.mutateAsync(data.id),
              )
            }
            onFulfill={() => setFulfillOpen(true)}
            pending={
              approve.isPending || reject.isPending || cancel.isPending
            }
          />
        )}

        {/* Fulfill sheet */}
        {data && (
          <FulfillSheet
            open={fulfillOpen}
            onClose={() => setFulfillOpen(false)}
            requisition={data}
            onSuccess={() => req.refetch()}
          />
        )}
      </YStack>
    </>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────

function StatusBadgeLarge({ status }: { status: RequisitionStatus }) {
  const styling = STATUS_STYLE[status]
  return (
    <YStack bg={styling.bg} br={9999} px="$3" py="$1">
      <Paragraph
        fontFamily={FONTS.bodyBold}
        fontSize={11}
        color={styling.fg}
      >
        {styling.label}
      </Paragraph>
    </YStack>
  )
}

const STATUS_STYLE: Record<
  RequisitionStatus,
  { bg: string; fg: string; label: string }
> = {
  pending: { bg: '#FFF3CD', fg: '#9a4600', label: 'MENUNGGU' },
  approved: { bg: '#dbeafe', fg: '#1e40af', label: 'DISETUJUI' },
  fulfilled: { bg: '#e6f4ea', fg: '#148E47', label: 'TERPENUHI' },
  rejected: { bg: '#ffdad6', fg: '#93000a', label: 'DITOLAK' },
  cancelled: { bg: '#e4eae0', fg: '#3e4a3f', label: 'DIBATALKAN' },
}

function BranchKv({ label, name }: { label: string; name: string }) {
  return (
    <XStack jc="space-between" ai="center">
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={12}
        color={COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.headingSemi}
        fontSize={14}
        color={COLORS.onSurface}
      >
        {name}
      </Paragraph>
    </XStack>
  )
}

function SectionTitle({ label }: { label: string }) {
  return (
    <Paragraph
      fontFamily={FONTS.bodyBold}
      fontSize={11}
      color={COLORS.onSurfaceVariant}
      letterSpacing={0.55}
      mt="$1"
    >
      {label}
    </Paragraph>
  )
}

function TimelineRow({ label, at }: { label: string; at: string }) {
  return (
    <XStack jc="space-between">
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={12}
        color={COLORS.onSurfaceVariant}
      >
        {label}
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={12}
        color={COLORS.onSurface}
      >
        {formatJakartaDate(at)}
      </Paragraph>
    </XStack>
  )
}

function ActionBar({
  req,
  isOwner,
  onApprove,
  onReject,
  onCancel,
  onFulfill,
  pending,
}: {
  req: RequisitionDetail
  isOwner: boolean
  onApprove: () => void
  onReject: () => void
  onCancel: () => void
  onFulfill: () => void
  pending: boolean
}) {
  // No actions at terminal states.
  if (
    req.status === 'fulfilled' ||
    req.status === 'rejected' ||
    req.status === 'cancelled'
  ) {
    return null
  }

  return (
    <YStack
      bg={COLORS.surfaceContainerLowest}
      borderTopWidth={1}
      borderTopColor={COLORS.outlineVariant}
      p="$3"
      gap="$2"
    >
      {req.status === 'pending' && (
        <XStack gap="$2">
          {isOwner && (
            <>
              <Button
                flex={1}
                bg={COLORS.surfaceContainerLow}
                color={COLORS.danger}
                borderWidth={1}
                borderColor={COLORS.danger}
                br={9999}
                h={48}
                pressStyle={{ bg: COLORS.errorContainer }}
                onPress={onReject}
                disabled={pending}
              >
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  color={COLORS.danger}
                >
                  Tolak
                </Paragraph>
              </Button>
              <Button
                flex={2}
                bg={COLORS.primary}
                pressStyle={{ bg: COLORS.brandActive }}
                borderWidth={0}
                br={9999}
                h={48}
                onPress={onApprove}
                disabled={pending}
              >
                <Paragraph fontFamily={FONTS.bodyBold} color="white">
                  Setujui
                </Paragraph>
              </Button>
            </>
          )}
          {!isOwner && (
            <Button
              flex={1}
              bg={COLORS.surfaceContainerLow}
              borderWidth={1}
              borderColor={COLORS.outlineVariant}
              br={9999}
              h={48}
              onPress={onCancel}
              disabled={pending}
            >
              <Paragraph
                fontFamily={FONTS.bodyBold}
                color={COLORS.onSurface}
              >
                Batalkan
              </Paragraph>
            </Button>
          )}
        </XStack>
      )}

      {req.status === 'approved' && isOwner && (
        <Button
          bg={COLORS.primary}
          pressStyle={{ bg: COLORS.brandActive }}
          borderWidth={0}
          br={9999}
          h={52}
          onPress={onFulfill}
          disabled={pending}
        >
          <CheckCircle2 size={18} color="white" />
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={15}
            color="white"
          >
            Penuhi Permintaan
          </Paragraph>
        </Button>
      )}
    </YStack>
  )
}

function ErrorPanel({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Gagal memuat.'
  return (
    <YStack flex={1} ai="center" jc="center" gap="$3" px="$6">
      <AlertCircle size={48} color={COLORS.outline} />
      <Paragraph
        fontFamily={FONTS.headingBold}
        fontSize={16}
        color={COLORS.onSurface}
      >
        Gagal memuat permintaan
      </Paragraph>
      <Paragraph
        fontFamily={FONTS.body}
        fontSize={13}
        color={COLORS.onSurfaceVariant}
        ta="center"
      >
        {message}
      </Paragraph>
    </YStack>
  )
}

// ─── Fulfill sheet — set fulfilledQty per line ──────────────────────

function FulfillSheet({
  open,
  onClose,
  requisition,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  requisition: RequisitionDetail
  onSuccess?: () => void
}) {
  // Initial state: fulfill exactly what was requested per line.
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      requisition.lines.map((l) => [l.id, String(l.requestedQty)]),
    ),
  )
  const [error, setError] = useState<string | null>(null)
  const fulfill = useFulfillRequisition()

  async function handleSubmit() {
    setError(null)
    try {
      await fulfill.mutateAsync({
        id: requisition.id,
        lines: requisition.lines.map((l) => ({
          id: l.id,
          fulfilledQty: parseFloat(quantities[l.id] || '0') || 0,
        })),
      })
      onSuccess?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan.')
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onClose}
      snapPoints={[80]}
      modal
      dismissOnSnapToBottom
    >
      <Sheet.Overlay />
      <Sheet.Handle />
      <Sheet.Frame bg={COLORS.surfaceContainerLowest}>
        <YStack flex={1}>
          <XStack
            ai="center"
            jc="space-between"
            px="$4"
            py="$3"
            borderBottomWidth={1}
            borderBottomColor={COLORS.outlineVariant}
          >
            <YStack flex={1}>
              <Paragraph
                fontFamily={FONTS.headingBold}
                fontSize={18}
                color={COLORS.onSurface}
              >
                Penuhi Permintaan
              </Paragraph>
              <Paragraph
                fontFamily={FONTS.body}
                fontSize={12}
                color={COLORS.onSurfaceVariant}
              >
                Set jumlah yang dikirim per item
              </Paragraph>
            </YStack>
            <Pressable onPress={onClose} hitSlop={8}>
              <YStack
                w={32}
                h={32}
                br={16}
                bg={COLORS.surfaceContainerLow}
                ai="center"
                jc="center"
              >
                <X size={18} color={COLORS.onSurfaceVariant} />
              </YStack>
            </Pressable>
          </XStack>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 16, gap: 10 }}
            keyboardShouldPersistTaps="handled"
          >
            {requisition.lines.map((l) => (
              <YStack
                key={l.id}
                bg={COLORS.surfaceContainerLow}
                br="$3"
                p="$3"
                gap="$2"
              >
                <XStack jc="space-between" ai="center">
                  <Paragraph
                    fontFamily={FONTS.headingSemi}
                    fontSize={13}
                    color={COLORS.onSurface}
                    flex={1}
                    numberOfLines={2}
                  >
                    {l.itemName}
                  </Paragraph>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    diminta {fmtQty(l.requestedQty)} {l.baseUnitLabel}
                  </Paragraph>
                </XStack>
                <XStack ai="center" gap="$2">
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={12}
                    color={COLORS.onSurfaceVariant}
                  >
                    Dikirim
                  </Paragraph>
                  <YStack flex={1}>
                    <YStack
                      bg={COLORS.surfaceContainerLowest}
                      br={9999}
                      h={40}
                      jc="center"
                      px="$3"
                      borderWidth={1}
                      borderColor={COLORS.outlineVariant}
                    >
                      <Paragraph
                        fontFamily={FONTS.mono}
                        fontSize={14}
                        color={COLORS.onSurface}
                      >
                        {quantities[l.id]}
                      </Paragraph>
                    </YStack>
                  </YStack>
                  <Paragraph
                    fontFamily={FONTS.body}
                    fontSize={11}
                    color={COLORS.onSurfaceVariant}
                  >
                    {l.baseUnitLabel}
                  </Paragraph>
                </XStack>
                <XStack gap="$1">
                  {[0, 0.5, 1].map((m) => (
                    <Pressable
                      key={m}
                      onPress={() =>
                        setQuantities((q) => ({
                          ...q,
                          [l.id]: String(l.requestedQty * m),
                        }))
                      }
                    >
                      <YStack
                        bg={COLORS.surfaceContainerLowest}
                        br={9999}
                        px="$2.5"
                        py="$1"
                        borderWidth={1}
                        borderColor={COLORS.outlineVariant}
                      >
                        <Paragraph
                          fontFamily={FONTS.bodyBold}
                          fontSize={11}
                          color={COLORS.onSurface}
                        >
                          {m === 0 ? '0' : m === 1 ? '100%' : '50%'}
                        </Paragraph>
                      </YStack>
                    </Pressable>
                  ))}
                </XStack>
              </YStack>
            ))}
            {error && (
              <YStack
                bg={COLORS.errorContainer}
                br="$3"
                p="$3"
                borderWidth={1}
                borderColor={COLORS.error}
              >
                <Paragraph
                  fontFamily={FONTS.body}
                  fontSize={13}
                  color={COLORS.onErrorContainer}
                >
                  {error}
                </Paragraph>
              </YStack>
            )}
          </ScrollView>

          <YStack
            px="$4"
            py="$3"
            borderTopWidth={1}
            borderTopColor={COLORS.outlineVariant}
          >
            <Button
              bg={COLORS.primary}
              pressStyle={{ bg: COLORS.brandActive }}
              borderWidth={0}
              br={9999}
              h={52}
              onPress={handleSubmit}
              disabled={fulfill.isPending}
            >
              {fulfill.isPending ? (
                <Spinner color="white" />
              ) : (
                <Paragraph
                  fontFamily={FONTS.bodyBold}
                  fontSize={15}
                  color="white"
                >
                  Konfirmasi Pengiriman
                </Paragraph>
              )}
            </Button>
          </YStack>
        </YStack>
      </Sheet.Frame>
    </Sheet>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────

function fmtQty(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.?0+$/, '')
}

function formatJakartaDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}
