import { useEffect, useRef, useState } from 'react'
import { X, Camera, RotateCcw, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './button'

interface Props {
  open: boolean
  /** Longest-edge cap for the captured image, in px. */
  maxDim?: number
  /** Receives the captured frame as a JPEG data URL. */
  onCapture: (dataUrl: string) => void
  onClose: () => void
}

/**
 * In-browser camera capture. Streams the device camera (rear-facing when
 * available), lets the user snap a frame, review it, and confirm. Works on
 * desktop and mobile; requires a secure context (HTTPS or localhost).
 */
export function CameraCaptureModal({
  open,
  maxDim = 1536,
  onCapture,
  onClose,
}: Props) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(true)
  const [captured, setCaptured] = useState<string | null>(null)

  // Acquire the camera stream while the modal is open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    setCaptured(null)
    setStarting(true)

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setStarting(false)
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('konten.cameraError'))
          setStarting(false)
        }
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((tr) => tr.stop())
      streamRef.current = null
    }
  }, [open, t])

  // Escape to close + body scroll lock.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  function takePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const scale = Math.min(
      1,
      maxDim / Math.max(video.videoWidth, video.videoHeight),
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    setCaptured(canvas.toDataURL('image/jpeg', 0.9))
  }

  function usePhoto() {
    if (!captured) return
    onCapture(captured)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-black/80"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-[61] flex w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-gray-800">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('konten.cameraTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel')}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex aspect-[4/3] items-center justify-center bg-black">
          {error ? (
            <p className="px-6 text-center text-sm text-white/80">{error}</p>
          ) : (
            <>
              {/* Live preview — hidden under the still once captured. */}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className={captured ? 'hidden' : 'h-full w-full object-contain'}
              />
              {captured && (
                <img
                  src={captured}
                  alt=""
                  className="h-full w-full object-contain"
                />
              )}
              {starting && !captured && (
                <p className="absolute text-sm text-white/70">
                  {t('konten.cameraStarting')}
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          {error ? (
            <Button variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          ) : captured ? (
            <>
              <Button variant="ghost" onClick={() => setCaptured(null)}>
                <RotateCcw className="h-4 w-4" />
                {t('konten.cameraRetake')}
              </Button>
              <Button variant="brand" onClick={usePhoto}>
                <Check className="h-4 w-4" />
                {t('konten.cameraUse')}
              </Button>
            </>
          ) : (
            <Button variant="brand" disabled={starting} onClick={takePhoto}>
              <Camera className="h-4 w-4" />
              {t('konten.cameraCapture')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
