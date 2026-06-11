import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QrCode, Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  captured: string | null
  onCapture: (token: string | null) => void
}

/**
 * QR scanner using @zxing/browser. Wraps `BrowserQRCodeReader.decodeFromVideoDevice`
 * which handles the camera lifecycle + continuous decoding in one call.
 * On decode, passes the raw token string to `onCapture` — no validation here,
 * the server does HMAC + nonce verification.
 */
export function QrCheckIn({ captured, onCapture }: Props) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function startScan() {
    setError(null)
    setScanning(true)
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser')
      const reader = new BrowserQRCodeReader()
      if (!videoRef.current) return
      const controls = await reader.decodeFromVideoDevice(
        undefined, // default camera
        videoRef.current,
        (result, err, c) => {
          if (result) {
            onCapture(result.getText())
            c.stop()
            setScanning(false)
          }
          // `err` fires for every frame that didn't decode — ignore
        },
      )
      controlsRef.current = controls
    } catch (err) {
      setError(err instanceof Error ? err.message : t('checkIn.qrScanFailed'))
      setScanning(false)
    }
  }

  function stopScan() {
    controlsRef.current?.stop()
    controlsRef.current = null
    setScanning(false)
  }

  useEffect(() => {
    return () => stopScan()
  }, [])

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <QrCode className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
          {t('checkIn.qrStepTitle')}
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
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('checkIn.qrScanned')}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              onCapture(null)
              void startScan()
            }}
          >
            <RotateCcw className="h-4 w-4" />
            {t('checkIn.retake')}
          </Button>
        </>
      ) : scanning ? (
        <div className="space-y-3">
          <video
            ref={videoRef}
            className="w-full max-w-xs rounded-lg border border-gray-200 dark:border-gray-700"
            playsInline
            muted
          />
          <Button type="button" variant="ghost" onClick={stopScan}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            {t('checkIn.qrStepDesc')}
          </p>
          <Button type="button" variant="brand" onClick={startScan}>
            <QrCode className="h-4 w-4" />
            {t('checkIn.qrStart')}
          </Button>
          {error && (
            <p className="mt-2 text-sm text-danger-600">{error}</p>
          )}
        </>
      )}
    </div>
  )
}
