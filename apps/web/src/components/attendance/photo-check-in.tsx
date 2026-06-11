import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  captured: string | null // data URL
  onCapture: (dataUrl: string | null) => void
}

/** Capture target — we compress aggressively to stay under 500 KB. */
const JPEG_QUALITY = 0.7
const MAX_DIMENSION = 1024

export function PhotoCheckIn({ captured, onCapture }: Props) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startCamera() {
    try {
      setError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      // Flip state first so the <video> element mounts. The effect below
      // then attaches the stream as soon as the ref is available. We can't
      // touch videoRef.current here because the element isn't in the DOM
      // yet — it's conditionally rendered on `streaming`.
      setStreaming(true)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('checkIn.photoPermissionError'),
      )
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setStreaming(false)
  }

  // Attach the stream once the <video> element is mounted.
  useEffect(() => {
    if (!streaming) return
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream) return
    video.srcObject = stream
    // Must call .play() explicitly on some Chromium-based browsers
    // (Mi Browser, UC, etc.) — autoplay attribute alone isn't enough.
    video.play().catch((err) => {
      setError(
        err instanceof Error ? err.message : t('checkIn.photoPermissionError'),
      )
    })
  }, [streaming, t])

  useEffect(() => {
    return () => stopCamera()
  }, [])

  function snap() {
    if (!videoRef.current || !streaming) return
    const video = videoRef.current
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return

    // Scale down to keep under 500 KB reliably
    const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(w * scale)
    canvas.height = Math.floor(h * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    onCapture(dataUrl)
    stopCamera()
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <Camera className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
          {t('checkIn.photoStepTitle')}
        </h3>
        {captured && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-700 dark:bg-success-900/30 dark:text-success-400">
            <Check className="h-3 w-3" />
            {t('checkIn.captured')}
          </span>
        )}
      </div>

      {captured ? (
        <>
          <img
            src={captured}
            alt="selfie"
            className="w-full max-w-xs rounded-lg border border-gray-200 dark:border-gray-700"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              onCapture(null)
              void startCamera()
            }}
          >
            <RotateCcw className="h-4 w-4" />
            {t('checkIn.retake')}
          </Button>
        </>
      ) : streaming ? (
        <div className="space-y-3">
          <video
            ref={videoRef}
            className="w-full max-w-xs rounded-lg border border-gray-200 dark:border-gray-700"
            autoPlay
            playsInline
            muted
          />
          <div className="flex gap-2">
            <Button type="button" variant="brand" onClick={snap}>
              <Camera className="h-4 w-4" />
              {t('checkIn.photoTake')}
            </Button>
            <Button type="button" variant="ghost" onClick={stopCamera}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            {t('checkIn.photoStepDesc')}
          </p>
          <Button type="button" variant="brand" onClick={startCamera}>
            <Camera className="h-4 w-4" />
            {t('checkIn.photoStart')}
          </Button>
          {error && (
            <p className="mt-2 text-sm text-danger-600">{error}</p>
          )}
        </>
      )}
    </div>
  )
}
