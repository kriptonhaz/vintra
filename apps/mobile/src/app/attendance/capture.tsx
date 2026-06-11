/**
 * Selfie capture + submit screen — combines chunks 2 + 3 of Phase 2.
 *
 * Single screen with three states:
 *   1. Camera preview (front-facing) → user taps "Ambil Foto"
 *   2. Photo preview with "Ulangi" + "Kirim" — server fn fires on Kirim
 *   3. Submitting / success / error
 *
 * Why one screen and not three: the flow is < 5 seconds and the user
 * needs to keep their selfie + location context in working memory.
 * Routing between screens loses that.
 *
 * Decision on which action (in vs out) comes from today's record at
 * submit time — re-fetched server-side, so even if the user took 30
 * minutes between opening the Absensi tab and pressing the button,
 * we won't double-clock-in.
 */
import { useRef, useState } from 'react'
import { useRouter } from 'expo-router'
import { Pressable } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import {
  AlertTriangle,
  Camera as CameraIcon,
  Check,
  RotateCcw,
  X,
} from '~/lib/icons'
import {
  Button,
  Card,
  H1,
  H4,
  Image,
  Paragraph,
  Spinner,
  XStack,
  YStack,
} from 'tamagui'
import {
  useClockIn,
  useClockOut,
  useTodayStatus,
} from '../../lib/attendance'
import { useDeviceLocation } from '../../lib/use-location'
import { useOutlet } from '../../lib/outlet-context'

export default function CaptureScreen() {
  const router = useRouter()
  const { selectedBranchId } = useOutlet()
  const today = useTodayStatus({ branchId: selectedBranchId })
  const { status: locStatus } = useDeviceLocation()
  const [permission, requestPermission] = useCameraPermissions()
  const cameraRef = useRef<CameraView | null>(null)
  const [previewUri, setPreviewUri] = useState<string | null>(null)
  // Held alongside the URI so we don't need a second read at submit time
  // (file:// → base64 conversion costs CPU + can fail).
  const [previewBase64, setPreviewBase64] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)

  const clockIn = useClockIn()
  const clockOut = useClockOut()
  const submitting = clockIn.isPending || clockOut.isPending
  const submitError =
    clockIn.error || clockOut.error
      ? (clockIn.error ?? clockOut.error) instanceof Error
        ? ((clockIn.error ?? clockOut.error) as Error).message
        : 'Gagal mengirim. Coba lagi.'
      : null

  // ── Permission gate ─────────────────────────────────────────────────
  if (!permission) {
    return (
      <Centered>
        <Spinner size="large" />
      </Centered>
    )
  }
  if (!permission.granted) {
    return (
      <YStack flex={1} ai="center" jc="center" p="$6" gap="$3">
        <CameraIcon size={48} color="$color9" />
        <H4>Izinkan kamera untuk selfie</H4>
        <Paragraph ta="center" col="$color10" maxWidth={280}>
          Foto selfie wajib untuk verifikasi check-in. Aplikasi tidak
          mengirim foto ke pihak ketiga — hanya tersimpan di akun
          usahamu.
        </Paragraph>
        <Button size="$4" bg="#006b32" color="white" borderWidth={0} onPress={requestPermission}>
          Izinkan Kamera
        </Button>
        <Button size="$3" variant="outlined" onPress={() => router.back()}>
          Batal
        </Button>
      </YStack>
    )
  }

  // ── Capture flow ────────────────────────────────────────────────────
  async function handleCapture() {
    if (!cameraRef.current || capturing) return
    setCapturing(true)
    try {
      // base64 returns the photo bytes inline so we don't need a
      // second file:// read at submit time. quality 0.7 + a ~800px
      // long edge from expo-camera's automatic resize keeps the
      // payload around 100-200KB — well under the server's 12MB cap
      // and fast to upload over Indonesian cell data.
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
        skipProcessing: false,
      })
      if (photo?.uri && photo.base64) {
        setPreviewUri(photo.uri)
        setPreviewBase64(photo.base64)
      }
    } catch (err) {
      console.warn('[capture] takePictureAsync failed', err)
    } finally {
      setCapturing(false)
    }
  }

  async function handleSubmit() {
    if (!previewBase64 || locStatus.kind !== 'ready') return

    const action = decideNextAction()
    const input = {
      lat: locStatus.lat,
      lng: locStatus.lng,
      photoDataUrl: `data:image/jpeg;base64,${previewBase64}`,
      branchId: selectedBranchId ?? undefined,
    }

    if (action === 'check-in') {
      await clockIn.mutateAsync(input).catch(() => {})
      if (!clockIn.isError) router.back()
    } else {
      await clockOut.mutateAsync(input).catch(() => {})
      if (!clockOut.isError) router.back()
    }
  }

  function decideNextAction(): 'check-in' | 'check-out' {
    const rec = today.data?.todayRecord
    if (!rec?.clockInAt) return 'check-in'
    return 'check-out'
  }

  // ── Render: preview vs camera ───────────────────────────────────────
  if (previewUri) {
    return (
      <YStack flex={1} bg="$background">
        <Image
          source={{ uri: previewUri }}
          flex={1}
          resizeMode="contain"
        />
        {submitError && (
          <Card
            bordered
            padded
            m="$3"
            bg="$red2"
            borderColor="$red8"
            gap="$1"
          >
            <XStack ai="center" gap="$2">
              <AlertTriangle size={16} color="$red10" />
              <H4 col="$red11" fontSize="$3">
                Gagal kirim
              </H4>
            </XStack>
            <Paragraph fontSize="$2" col="$color11">
              {submitError}
            </Paragraph>
          </Card>
        )}
        <XStack p="$4" gap="$3">
          <Button
            flex={1}
            size="$5"
            variant="outlined"
            disabled={submitting}
            onPress={() => {
              setPreviewUri(null)
              setPreviewBase64(null)
            }}
          >
            <RotateCcw size={18} />
            <Button.Text>Ulangi</Button.Text>
          </Button>
          <Button
            flex={1}
            size="$5"
            bg="#006b32" color="white" borderWidth={0}
            disabled={submitting || locStatus.kind !== 'ready'}
            onPress={handleSubmit}
          >
            {submitting ? (
              <Spinner />
            ) : (
              <>
                <Check size={18} color="white" />
                <Button.Text color="white">Kirim</Button.Text>
              </>
            )}
          </Button>
        </XStack>
      </YStack>
    )
  }

  return (
    <YStack flex={1} bg="black">
      <CameraView
        ref={(c) => {
          cameraRef.current = c
        }}
        style={{ flex: 1 }}
        facing="front"
      />
      <YStack
        position="absolute"
        top={0}
        left={0}
        right={0}
        p="$4"
        gap="$1"
      >
        <H1 col="white">Selfie Absensi</H1>
        <Paragraph col="white" opacity={0.85} fontSize="$2">
          Pastikan wajah terlihat jelas, lalu tap tombol kamera.
        </Paragraph>
      </YStack>
      <XStack
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        ai="center"
        jc="space-between"
        p="$5"
      >
        <Pressable onPress={() => router.back()}>
          <YStack
            w={48}
            h={48}
            br={24}
            bg="rgba(0,0,0,0.5)"
            ai="center"
            jc="center"
          >
            <X size={22} color="white" />
          </YStack>
        </Pressable>
        <Pressable onPress={handleCapture} disabled={capturing}>
          <YStack
            w={72}
            h={72}
            br={36}
            bg="white"
            borderWidth={4}
            borderColor="rgba(255,255,255,0.4)"
            ai="center"
            jc="center"
          >
            {capturing ? <Spinner color="black" /> : null}
          </YStack>
        </Pressable>
        <YStack w={48} />
      </XStack>
    </YStack>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <YStack flex={1} ai="center" jc="center">
      {children}
    </YStack>
  )
}
