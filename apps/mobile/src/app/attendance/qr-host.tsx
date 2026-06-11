/**
 * QR Kiosk host — staff scan the rotating QR to clock in/out.
 *
 *   1. Pick a branch
 *   2. Tap "Mulai" → calls startQrHost, then rotateQrToken to fetch the
 *      first token
 *   3. Render the QR + countdown; auto-refresh `rotateQrToken` at
 *      `rotationSeconds - 2s` so the displayed code never expires on
 *      screen
 *   4. On unmount or explicit "Stop", call stopQrHost
 *
 * The display screen is meant to be left running on a tablet at the
 * shop counter, so prevent screen-sleep via keep-awake (best-effort —
 * expo-keep-awake isn't in the dep set, so we just warn the user).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  useWindowDimensions,
} from 'react-native'
// eslint-disable-next-line import/no-named-as-default
import QRCode from 'react-native-qrcode-svg'
import { H2, Paragraph, XStack, YStack } from 'tamagui'
import { ScreenHeader } from '~/components/ScreenHeader'
import { Stat } from '~/components/Money'
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Check,
  QrCode,
  RotateCcw,
  X,
} from '~/lib/icons'
import {
  useAccessibleBranches,
  useRotateQrToken,
  useStartQrHost,
  useStopQrHost,
  type AccessibleBranch,
} from '~/lib/attendance'
import { ApiError } from '~/lib/api'
import { COLORS, FONTS, SHADOWS } from '~/lib/theme'

type Phase = 'idle' | 'running'

export default function QrHostScreen() {
  const branchesQuery = useAccessibleBranches()
  const start = useStartQrHost()
  const rotate = useRotateQrToken()
  const stop = useStopQrHost()

  const branches = branchesQuery.data?.branches ?? []

  const [phase, setPhase] = useState<Phase>('idle')
  const [branchId, setBranchId] = useState<string | null>(null)
  const [branchName, setBranchName] = useState<string>('')
  const [token, setToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [rotationSec, setRotationSec] = useState(30)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [pickerOpen, setPickerOpen] = useState(false)
  const rotateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!branchId && branches.length === 1) {
      setBranchId(branches[0]!.id)
      setBranchName(branches[0]!.name)
    }
  }, [branchId, branches])

  // Tick every second for the countdown — only when running
  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [phase])

  // Auto-rotate token N-2 seconds before it would expire
  function scheduleRotate(seconds: number) {
    if (rotateTimer.current) clearTimeout(rotateTimer.current)
    const wait = Math.max(2, seconds - 2) * 1000
    rotateTimer.current = setTimeout(() => {
      void rotateOnce()
    }, wait)
  }

  async function rotateOnce() {
    try {
      const result = await rotate.mutateAsync()
      setToken(result.token)
      setExpiresAt(new Date(result.expiresAt))
      setRotationSec(result.rotationSeconds)
      scheduleRotate(result.rotationSeconds)
    } catch (err) {
      Alert.alert(
        'Gagal rotate token',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
      setPhase('idle')
    }
  }

  async function handleStart() {
    if (!branchId) {
      Alert.alert('Pilih cabang', 'Pilih cabang sebelum mulai.')
      return
    }
    try {
      await start.mutateAsync(branchId)
      setPhase('running')
      await rotateOnce()
    } catch (err) {
      Alert.alert(
        'Gagal mulai',
        err instanceof Error ? err.message : 'Coba lagi.',
      )
    }
  }

  async function handleStop() {
    if (rotateTimer.current) {
      clearTimeout(rotateTimer.current)
      rotateTimer.current = null
    }
    setPhase('idle')
    setToken(null)
    setExpiresAt(null)
    try {
      await stop.mutateAsync()
    } catch {
      // best-effort
    }
  }

  // Stop host on unmount
  useEffect(() => {
    return () => {
      if (rotateTimer.current) clearTimeout(rotateTimer.current)
      if (phase === 'running') {
        void stop.mutateAsync().catch(() => {})
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remainingSec = useMemo(() => {
    if (!expiresAt) return null
    return Math.max(0, Math.ceil((expiresAt.getTime() - nowMs) / 1000))
  }, [expiresAt, nowMs])

  if (branchesQuery.isLoading) {
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="QR Kiosk" back />
        <YStack flex={1} ai="center" jc="center">
          <ActivityIndicator color={COLORS.primary} />
        </YStack>
      </YStack>
    )
  }
  if (branchesQuery.error) {
    const isForbidden =
      branchesQuery.error instanceof ApiError &&
      branchesQuery.error.status === 403
    return (
      <YStack flex={1} bg={COLORS.background}>
        <ScreenHeader title="QR Kiosk" back />
        <YStack flex={1} ai="center" jc="center" px="$5" gap="$3">
          <AlertTriangle size={32} color={COLORS.danger} />
          <Paragraph
            fontFamily={FONTS.bodyMedium}
            fontSize={14}
            color={COLORS.onSurface}
            ta="center"
          >
            {isForbidden
              ? 'Akun kamu tidak punya akses ke QR kiosk.'
              : 'Gagal memuat daftar cabang.'}
          </Paragraph>
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg={COLORS.background}>
      <ScreenHeader
        title="QR Kiosk"
        subtitle={
          phase === 'running'
            ? `Berjalan · ${branchName}`
            : 'Tablet kiosk untuk clock-in staff'
        }
        back
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={branchesQuery.isFetching}
            onRefresh={() => branchesQuery.refetch()}
            tintColor={COLORS.primary}
          />
        }
      >
        {phase === 'idle' ? (
          <IdleView
            branches={branches}
            branchId={branchId}
            branchName={branchName}
            onPickBranch={() => setPickerOpen(true)}
            onStart={handleStart}
            starting={start.isPending || rotate.isPending}
          />
        ) : (
          <RunningView
            token={token}
            remainingSec={remainingSec}
            rotationSec={rotationSec}
            branchName={branchName}
            rotating={rotate.isPending}
            onForceRotate={rotateOnce}
            onStop={handleStop}
          />
        )}
      </ScrollView>

      <BranchPickerModal
        visible={pickerOpen}
        branches={branches}
        selectedId={branchId}
        onClose={() => setPickerOpen(false)}
        onSelect={(b) => {
          setBranchId(b.id)
          setBranchName(b.name)
          setPickerOpen(false)
        }}
      />
    </YStack>
  )
}

// ─── Idle view ──────────────────────────────────────────────────────

function IdleView({
  branches,
  branchId,
  branchName,
  onPickBranch,
  onStart,
  starting,
}: {
  branches: AccessibleBranch[]
  branchId: string | null
  branchName: string
  onPickBranch: () => void
  onStart: () => void
  starting: boolean
}) {
  return (
    <YStack gap="$4">
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={16}
        p="$4"
        gap="$2"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        style={SHADOWS.card}
      >
        <XStack ai="flex-start" gap="$2">
          <AlertCircle size={16} color={COLORS.primary} />
          <YStack flex={1}>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={13}
              color={COLORS.onSurface}
            >
              Cara pakai
            </Paragraph>
            <Paragraph
              fontFamily={FONTS.body}
              fontSize={12}
              color={COLORS.onSurfaceVariant}
            >
              Pilih cabang → tap Mulai. Pasang HP/tablet ini di kasir. QR
              akan otomatis berganti tiap beberapa detik supaya tidak
              bisa dipalsukan.
            </Paragraph>
          </YStack>
        </XStack>
      </YStack>

      {branches.length === 0 ? (
        <YStack
          ai="center"
          py="$8"
          bg={COLORS.surfaceContainerLowest}
          br={14}
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
          gap="$2"
        >
          <Building2 size={28} color={COLORS.outline} />
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={13}
            color={COLORS.onSurfaceVariant}
            ta="center"
            px="$4"
          >
            Belum ada cabang yang bisa kamu host. Tambah cabang dulu dari
            menu Master Data.
          </Paragraph>
        </YStack>
      ) : (
        <YStack gap="$2">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={12}
            color={COLORS.onSurface}
            textTransform="uppercase"
            letterSpacing={0.4}
          >
            Cabang
          </Paragraph>
          <Pressable
            onPress={onPickBranch}
            style={{
              backgroundColor: COLORS.surfaceContainerLowest,
              borderRadius: 12,
              paddingHorizontal: 14,
              height: 50,
              borderWidth: 1,
              borderColor: COLORS.borderSubtle,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <XStack ai="center" gap="$2">
              <Building2 size={16} color={COLORS.primary} />
              <Paragraph
                fontFamily={FONTS.bodyMedium}
                fontSize={14}
                color={branchId ? COLORS.onSurface : COLORS.outline}
              >
                {branchName || 'Pilih cabang…'}
              </Paragraph>
            </XStack>
            <Paragraph
              fontFamily={FONTS.bodyBold}
              fontSize={12}
              color={COLORS.primary}
            >
              Ganti
            </Paragraph>
          </Pressable>
        </YStack>
      )}

      <Pressable
        onPress={onStart}
        disabled={starting || !branchId}
        style={{
          paddingVertical: 16,
          borderRadius: 14,
          backgroundColor:
            starting || !branchId ? COLORS.outline : COLORS.primary,
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {starting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <QrCode size={18} color="#fff" />
            <Paragraph fontFamily={FONTS.bodyBold} fontSize={15} color="#fff">
              Mulai Sesi QR
            </Paragraph>
          </>
        )}
      </Pressable>
    </YStack>
  )
}

// ─── Running view ───────────────────────────────────────────────────

function RunningView({
  token,
  remainingSec,
  rotationSec,
  branchName,
  rotating,
  onForceRotate,
  onStop,
}: {
  token: string | null
  remainingSec: number | null
  rotationSec: number
  branchName: string
  rotating: boolean
  onForceRotate: () => void
  onStop: () => void
}) {
  const { width } = useWindowDimensions()
  const qrSize = Math.min(width - 80, 320)
  const pct =
    remainingSec !== null && rotationSec > 0
      ? Math.max(0, Math.min(1, remainingSec / rotationSec))
      : 0

  return (
    <YStack gap="$4" ai="center">
      <YStack
        bg={COLORS.surfaceContainerLowest}
        br={20}
        p="$5"
        ai="center"
        gap="$3"
        borderWidth={1}
        borderColor={COLORS.borderSubtle}
        style={SHADOWS.card}
        w="100%"
      >
        <YStack ai="center" gap={2}>
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
          >
            QR AKTIF · {branchName}
          </Paragraph>
          <Paragraph
            fontFamily={FONTS.body}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
          >
            Staff scan QR ini lewat tombol Absen di HP-nya.
          </Paragraph>
        </YStack>

        <YStack
          bg="#fff"
          p="$4"
          br={16}
          ai="center"
          jc="center"
          w={qrSize + 32}
          h={qrSize + 32}
          borderWidth={1}
          borderColor={COLORS.borderSubtle}
        >
          {token ? (
            <QRCode value={token} size={qrSize} backgroundColor="#fff" />
          ) : (
            <ActivityIndicator color={COLORS.primary} />
          )}
        </YStack>

        {/* Countdown */}
        <YStack ai="center" gap="$1" w="100%">
          <Paragraph
            fontFamily={FONTS.bodyBold}
            fontSize={11}
            color={COLORS.onSurfaceVariant}
            letterSpacing={0.55}
          >
            REFRESH OTOMATIS
          </Paragraph>
          <XStack ai="baseline" gap="$2">
            <Paragraph
              fontFamily={FONTS.monoMedium}
              fontSize={22}
              color={
                (remainingSec ?? 0) <= 5 ? COLORS.danger : COLORS.primary
              }
            >
              {remainingSec ?? '-'}
            </Paragraph>
            <Stat fontSize={12} color={COLORS.onSurfaceVariant}>
              detik
            </Stat>
          </XStack>
          <YStack
            w="100%"
            h={4}
            br={2}
            bg={COLORS.surfaceContainerLow}
            overflow="hidden"
          >
            <YStack
              h={4}
              br={2}
              bg={(remainingSec ?? 0) <= 5 ? COLORS.danger : COLORS.primary}
              width={`${pct * 100}%`}
            />
          </YStack>
        </YStack>
      </YStack>

      <XStack gap="$2" w="100%">
        <Pressable
          onPress={onForceRotate}
          disabled={rotating}
          style={{
            flex: 1,
            paddingVertical: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: COLORS.borderSubtle,
            backgroundColor: COLORS.surface,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {rotating ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : (
            <>
              <RotateCcw size={14} color={COLORS.onSurface} />
              <Paragraph
                fontFamily={FONTS.bodyBold}
                fontSize={13}
                color={COLORS.onSurface}
              >
                Refresh Sekarang
              </Paragraph>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={onStop}
          style={{
            flex: 1,
            paddingVertical: 14,
            borderRadius: 12,
            backgroundColor: COLORS.danger,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <X size={14} color="#fff" />
          <Paragraph fontFamily={FONTS.bodyBold} fontSize={13} color="#fff">
            Stop
          </Paragraph>
        </Pressable>
      </XStack>
    </YStack>
  )
}

// ─── Branch picker ──────────────────────────────────────────────────

function BranchPickerModal({
  visible,
  branches,
  selectedId,
  onClose,
  onSelect,
}: {
  visible: boolean
  branches: AccessibleBranch[]
  selectedId: string | null
  onClose: () => void
  onSelect: (b: AccessibleBranch) => void
}) {
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
            Pilih cabang
          </H2>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color={COLORS.onSurface} />
          </Pressable>
        </XStack>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
          {branches.map((b) => {
            const on = b.id === selectedId
            return (
              <Pressable key={b.id} onPress={() => onSelect(b)}>
                <XStack
                  ai="center"
                  jc="space-between"
                  p="$3"
                  br={12}
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
                    {b.name}
                  </Paragraph>
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
