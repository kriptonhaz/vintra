import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MapPin, Check, Navigation } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatGeolocationError } from '@/lib/geolocation-error'

export interface GpsCapture {
  lat: number
  lng: number
  accuracy: number
}

interface Props {
  captured: GpsCapture | null
  onCapture: (v: GpsCapture | null) => void
}

export function GpsCheckIn({ captured, onCapture }: Props) {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function capture() {
    if (!navigator.geolocation) {
      setError(t('checkIn.gpsUnsupported'))
      return
    }
    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onCapture({
          lat: Number(pos.coords.latitude.toFixed(7)),
          lng: Number(pos.coords.longitude.toFixed(7)),
          accuracy: Math.round(pos.coords.accuracy),
        })
        setLoading(false)
      },
      (err) => {
        // JUR-208: surface a localized, browser-aware hint instead of
        // the raw spec phrase ("User denied Geolocation") which most
        // cashiers don't know how to act on.
        setError(formatGeolocationError(err, t))
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center gap-2">
        <MapPin className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">
          {t('checkIn.gpsStepTitle')}
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
          <p className="font-mono text-xs text-gray-600 dark:text-gray-400">
            {captured.lat.toFixed(5)}, {captured.lng.toFixed(5)} (±{captured.accuracy}m)
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              onCapture(null)
              capture()
            }}
          >
            {t('checkIn.retake')}
          </Button>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
            {t('checkIn.gpsStepDesc')}
          </p>
          <Button
            type="button"
            variant="brand"
            onClick={capture}
            loading={loading}
          >
            <Navigation className="h-4 w-4" />
            {t('checkIn.gpsCapture')}
          </Button>
          {error && (
            <p className="mt-2 whitespace-pre-line text-sm text-danger-600">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}
