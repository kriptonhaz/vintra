import * as React from 'react'
import {
  Camera,
  CameraOff,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  X,
} from 'lucide-react'
import { compressImage } from '@/lib/image-compress'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * `(pointer: coarse)` reliably catches phones + tablets and excludes
 * desktops with a mouse. On those devices the `capture` input hint
 * opens the native camera; on desktops we fall through to a
 * getUserMedia-based capture modal because `capture` is silently
 * ignored there.
 */
function isLikelyTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(pointer: coarse)').matches
}

interface PhotoUploadFieldProps {
  /**
   * Current preview source. Either a fresh data URL the user just
   * picked, or a signed S3 URL for an already-uploaded photo. The
   * widget doesn't care which — both render in `<img src>`.
   */
  value: string | null
  /**
   * Fires when the user picks a new photo (compressed data URL ready
   * to ship to the server) or clears the existing one (`null`).
   */
  onChange: (next: string | null) => void
  /** Disable the input while the parent form is saving. */
  disabled?: boolean
  /** Inline error text — usually a server-side message. */
  error?: string | null
  className?: string
  /**
   * Longest-edge cap for the resize (px). Defaults to 800 — right for
   * small product/member thumbnails. Banners/hero images pass a much
   * larger value (e.g. 1920) so they stay sharp at full width.
   */
  maxEdge?: number
  /** Initial JPEG quality before adaptive size-fitting. Default 0.8. */
  quality?: number
  /** Size ceiling in KB (client + matches the server cap). Default 500. */
  maxKB?: number
}

/**
 * File picker + on-canvas compression + preview, in one widget.
 * Mobile users get the camera by default (`capture="environment"`),
 * desktop users get the file picker. Either way the result is
 * resized to ~800px and re-encoded as JPEG quality 0.8 so what we
 * upload is well under the server's 500 KB ceiling.
 *
 * The widget is dumb: it only manages the preview + emits data URLs.
 * The parent form decides when to actually call the upload server fn.
 */
export function PhotoUploadField({
  value,
  onChange,
  disabled,
  error,
  className,
  maxEdge = 800,
  quality = 0.8,
  maxKB = 500,
}: PhotoUploadFieldProps) {
  // Two distinct hidden inputs — one with the camera capture hint,
  // one without. The chooser modal triggers whichever the user picked.
  // Splitting them is what lets us offer "Galeri" on mobile where a
  // single capture-hinted input would force the camera UI.
  const cameraRef = React.useRef<HTMLInputElement>(null)
  const galleryRef = React.useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [webcamOpen, setWebcamOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | null>(null)
  const [compressedSize, setCompressedSize] = React.useState<number | null>(
    null,
  )

  async function handleFile(file: File) {
    setLocalError(null)
    setBusy(true)
    try {
      const { dataUrl, bytes } = await compressImage(file, {
        maxEdge,
        quality,
        targetBytes: maxKB * 1024,
      })
      // Hard ceiling — even after adaptive compression a worst-case
      // image might still exceed the server limit. Fail fast in the UI
      // rather than round-tripping a too-large data URL.
      if (bytes > maxKB * 1024) {
        setLocalError(
          `Foto masih ${Math.round(bytes / 1024)} KB setelah kompres. Coba foto lain.`,
        )
        return
      }
      setCompressedSize(bytes)
      onChange(dataUrl)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Gagal memproses foto.')
    } finally {
      setBusy(false)
      // Reset BOTH inputs so the same file can be re-selected later.
      if (cameraRef.current) cameraRef.current.value = ''
      if (galleryRef.current) galleryRef.current.value = ''
    }
  }

  function handleRemove() {
    setCompressedSize(null)
    setLocalError(null)
    onChange(null)
  }

  function openSource(source: 'camera' | 'gallery') {
    setPickerOpen(false)
    setTimeout(() => {
      if (source === 'gallery') {
        galleryRef.current?.click()
        return
      }
      // Camera path. Touch devices (phones/tablets) honour the
      // capture-hinted file input — the OS opens the native camera
      // which is what users expect. Desktop browsers ignore
      // `capture` and fall back to a file picker, which defeats the
      // purpose of having a separate option, so we go through
      // getUserMedia instead and capture from the webcam.
      if (isLikelyTouchDevice()) {
        cameraRef.current?.click()
      } else {
        setWebcamOpen(true)
      }
    }, 0)
  }

  const shownError = error ?? localError

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
        className="hidden"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled || busy}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
        className="hidden"
      />

      {value ? (
        <div className="relative">
          <img
            src={value}
            alt="Pratinjau foto item"
            className="h-40 w-full rounded-lg border border-gray-200 object-cover dark:border-gray-700"
          />
          <button
            type="button"
            onClick={handleRemove}
            disabled={disabled || busy}
            className="absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-sm hover:bg-white hover:text-danger-600 disabled:opacity-50 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:bg-gray-900"
            aria-label="Hapus foto"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={disabled || busy}
            className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-white disabled:opacity-50 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:bg-gray-900"
          >
            <Camera className="h-3.5 w-3.5" />
            Ganti
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          disabled={disabled || busy}
          className={cn(
            'flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm transition-colors',
            shownError
              ? 'border-danger-300 bg-danger-50/50 text-danger-700 dark:border-danger-900/40 dark:bg-danger-900/10 dark:text-danger-400'
              : 'border-gray-300 bg-gray-50 text-gray-600 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700/50',
            (disabled || busy) && 'cursor-not-allowed opacity-60',
          )}
        >
          {busy ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Memproses foto…</span>
            </>
          ) : (
            <>
              <ImageIcon className="h-6 w-6" />
              <span className="font-medium">Pilih atau ambil foto</span>
              <span className="text-xs">
                JPG/PNG/WebP, otomatis dikompres ~{maxEdge} px
              </span>
            </>
          )}
        </button>
      )}

      {compressedSize != null && !shownError && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Ukuran setelah kompres: {Math.round(compressedSize / 1024)} KB
        </p>
      )}
      {shownError && (
        <p className="text-xs text-danger-600 dark:text-danger-400">
          {shownError}
        </p>
      )}

      <Dialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        className="max-w-sm"
      >
        <div className="flex flex-col gap-2 px-6 py-5">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Tambah foto
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Pilih sumber foto.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => openSource('camera')}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-gray-200 bg-white px-4 py-5 text-center transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-500 dark:hover:bg-brand-900/20"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                <Camera className="h-5 w-5" />
              </div>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Kamera
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Ambil foto langsung
              </span>
            </button>
            <button
              type="button"
              onClick={() => openSource('gallery')}
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-gray-200 bg-white px-4 py-5 text-center transition-colors hover:border-brand-400 hover:bg-brand-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-500 dark:hover:bg-brand-900/20"
            >
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-400">
                <FolderOpen className="h-5 w-5" />
              </div>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Galeri
              </span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Pilih dari file/galeri
              </span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPickerOpen(false)}
            className="mt-3 self-end px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Batal
          </button>
        </div>
      </Dialog>

      <WebcamCaptureDialog
        open={webcamOpen}
        onClose={() => setWebcamOpen(false)}
        onCapture={(file) => {
          setWebcamOpen(false)
          handleFile(file)
        }}
      />
    </div>
  )
}

/**
 * Desktop-only webcam capture modal. Opens a getUserMedia stream,
 * shows a live preview, and snaps a frame to a File on demand.
 *
 * Stream lifecycle: started inside an effect when `open` flips true,
 * stopped (all tracks) in the cleanup. Closing the modal triggers
 * the cleanup so we never leave the camera light on.
 *
 * Permissions: if the user denies access (or the browser blocks it
 * over insecure HTTP), we render an explanatory message instead of
 * a blank video element.
 */
function WebcamCaptureDialog({
  open,
  onClose,
  onCapture,
}: {
  open: boolean
  onClose: () => void
  onCapture: (file: File) => void
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setReady(false)

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError('Browser ini tidak mendukung akses kamera.')
      return
    }

    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          video.play().catch(() => {
            // Autoplay blocked — user just clicks the snap button
            // again once the preview comes up.
          })
          setReady(true)
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg =
          err instanceof Error
            ? err.name === 'NotAllowedError'
              ? 'Akses kamera ditolak. Izinkan di pengaturan browser lalu coba lagi.'
              : err.name === 'NotFoundError'
                ? 'Tidak ada kamera ditemukan di perangkat ini.'
                : err.message
            : 'Gagal mengakses kamera.'
        setError(msg)
      })

    return () => {
      cancelled = true
      const stream = streamRef.current
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [open])

  function snap() {
    const video = videoRef.current
    if (!video) return
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, w, h)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const file = new File([blob], `camera-${Date.now()}.jpg`, {
          type: 'image/jpeg',
        })
        onCapture(file)
      },
      'image/jpeg',
      0.92,
    )
  }

  return (
    <Dialog open={open} onClose={onClose} className="max-w-md">
      <div className="flex flex-col gap-3 px-6 py-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Ambil foto
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-6 text-center text-sm text-warning-800 dark:border-warning-900/40 dark:bg-warning-900/20 dark:text-warning-200">
            <CameraOff className="h-6 w-6" />
            <p>{error}</p>
          </div>
        ) : (
          <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
            />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center text-white">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          {ready && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                // Restart the stream so the user can re-frame after
                // a denied snap or an awkward angle.
                const stream = streamRef.current
                if (stream) {
                  stream.getTracks().forEach((t) => t.stop())
                  streamRef.current = null
                }
                setReady(false)
                // Trigger re-mount of the effect via a key bump trick:
                // toggling open isn't ideal, but it's the simplest
                // way without restructuring. Instead just re-call
                // getUserMedia inline.
                navigator.mediaDevices
                  .getUserMedia({
                    video: {
                      facingMode: 'environment',
                      width: { ideal: 1280 },
                    },
                    audio: false,
                  })
                  .then((s) => {
                    streamRef.current = s
                    if (videoRef.current) {
                      videoRef.current.srcObject = s
                      videoRef.current.play().catch(() => {})
                      setReady(true)
                    }
                  })
                  .catch(() => {})
              }}
              className="gap-1"
            >
              <RotateCcw className="h-4 w-4" />
              Ulang
            </Button>
          )}
          <Button
            type="button"
            variant="brand"
            onClick={snap}
            disabled={!ready}
            className="gap-1"
          >
            <Camera className="h-4 w-4" />
            Ambil
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
