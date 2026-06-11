/**
 * Foreground location hook — requests permission, fetches current
 * position, exposes the result + retry. Foreground only for v1 —
 * background ("notify me 30 min after shift end if I forgot to
 * check out") would force the user through a second permission
 * dialog that scares people; defer until we know we need it.
 */
import { useCallback, useEffect, useState } from 'react'
import * as Location from 'expo-location'

export type LocationStatus =
  | { kind: 'idle' }
  | { kind: 'requesting-permission' }
  | { kind: 'permission-denied' }
  | { kind: 'fetching' }
  | { kind: 'ready'; lat: number; lng: number; accuracyMeters: number | null }
  | { kind: 'error'; message: string }

export function useDeviceLocation(): {
  status: LocationStatus
  refresh: () => Promise<void>
} {
  const [status, setStatus] = useState<LocationStatus>({ kind: 'idle' })

  const refresh = useCallback(async () => {
    setStatus({ kind: 'requesting-permission' })
    const perm = await Location.requestForegroundPermissionsAsync()
    if (perm.status !== 'granted') {
      setStatus({ kind: 'permission-denied' })
      return
    }
    setStatus({ kind: 'fetching' })
    try {
      // `High` accuracy is the realistic upper bound for outdoor
      // warung use — Balanced often lands 50-100m off, which would
      // wrongly trigger "you're outside the geofence" warnings for
      // staff actually standing at the door.
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      })
      setStatus({
        kind: 'ready',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracyMeters: pos.coords.accuracy ?? null,
      })
    } catch (err) {
      setStatus({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Tidak bisa mengambil lokasi. Coba lagi.',
      })
    }
  }, [])

  // Auto-fetch on mount so the user lands on a "you're at the
  // branch" screen instead of having to tap "Ambil Lokasi" first.
  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, refresh }
}
