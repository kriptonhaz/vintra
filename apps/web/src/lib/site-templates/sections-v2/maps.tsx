/**
 * Maps — interactive Leaflet map pinning the tenant's branch locations.
 *
 * Why Leaflet + OpenStreetMap (not the Google embed it replaced):
 *   - no API key, no billing — the old keyless Google iframe could
 *     only show ONE location and couldn't use a custom marker icon.
 *   - Leaflet renders every branch as a marker on one map and lets us
 *     use the Vintra logo as the pin via a `divIcon`.
 *
 * Branch coordinates come straight from `branches.latitude/longitude`
 * (already stored for attendance geofencing) — no geocoding needed.
 *
 * SSR: Leaflet touches `window`, so the map is initialised client-side
 * inside `useEffect` via a dynamic `import('leaflet')`. The server
 * renders an empty sized container; the address list below the map
 * doubles as the no-JS / SEO fallback.
 */
import 'leaflet/dist/leaflet.css'
import { MapPin } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import type { Map as LeafletMap } from 'leaflet'
// Vite-imported so the bundle gets a hashed URL that nginx serves via
// the /assets/ location. The plain "/logo.png" path falls through to
// the SSR proxy and 404s — only specific filenames (favicon, robots,
// manifest, sw.js) have nginx exact-match routes.
import fallbackLogo from '@/assets/images/logo.png'
import type {
  PublicSiteRenderData,
  SectionDef,
  SectionRenderProps,
} from '../v2-types'

type Branch = PublicSiteRenderData['branches'][number]

/** A `0,0` pair (or NaN) means the branch never had its location set. */
function hasValidCoords(b: Branch): boolean {
  return (
    Number.isFinite(b.latitude) &&
    Number.isFinite(b.longitude) &&
    !(b.latitude === 0 && b.longitude === 0)
  )
}

/** Escape user-supplied text before it goes into Leaflet popup HTML. */
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] ?? c,
  )
}

/** A teardrop pin with the business logo inside a brand-colored ring. */
function pinHtml(brandColor: string, logoUrl: string): string {
  return `
    <div style="position:relative;width:46px;height:56px;">
      <div style="width:46px;height:46px;border-radius:50%;background:#fff;
        border:3px solid ${brandColor};box-shadow:0 2px 6px rgba(0,0,0,0.35);
        display:flex;align-items:center;justify-content:center;overflow:hidden;">
        <img src="${logoUrl}" alt="" style="width:32px;height:32px;object-fit:contain;" />
      </div>
      <div style="position:absolute;left:50%;bottom:1px;transform:translateX(-50%);
        width:0;height:0;border-left:8px solid transparent;
        border-right:8px solid transparent;border-top:11px solid ${brandColor};"></div>
    </div>
  `
}

function MapsRender({
  data,
  settings,
  theme,
  resolveAssetUrl,
  isEditorPreview,
}: SectionRenderProps) {
  const heading = (settings.heading as string)?.trim() || 'Lokasi'
  const mapProvider = settings.mapProvider === 'google' ? 'google' : 'leaflet'
  // Tenant's own logo for the marker; falls back to the Vintra logo
  // when they haven't uploaded one in the Theme card.
  const logoUrl = resolveAssetUrl(theme.logoAssetKey) ?? fallbackLogo
  const branchIds = useMemo(
    () =>
      Array.isArray(settings.branchIds)
        ? (settings.branchIds.filter(
            (v) => typeof v === 'string',
          ) as string[])
        : [],
    [settings.branchIds],
  )

  // Resolve which branches to show. Empty selection = all branches. If
  // every picked id is stale (outlets deleted after the section was
  // configured), fall back to all so the section never blanks.
  // Memoised so the map-init effect doesn't re-run on every render.
  const pins = useMemo(() => {
    const withCoords = data.branches.filter(hasValidCoords)
    if (branchIds.length === 0) return withCoords
    const picked = withCoords.filter((b) => branchIds.includes(b.id))
    return picked.length > 0 ? picked : withCoords
  }, [data.branches, branchIds])

  // Google's keyless embed shows a single location — prefer the main
  // branch, else the first selected.
  const googleBranch = pins.find((b) => b.isMain) ?? pins[0] ?? null

  const mapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = mapRef.current
    if (mapProvider !== 'leaflet' || !el || pins.length === 0) return
    let map: LeafletMap | null = null
    let cancelled = false

    void import('leaflet').then((L) => {
      if (cancelled || !mapRef.current) return
      map = L.map(el, {
        scrollWheelZoom: false,
        attributionControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map)

      const icon = L.divIcon({
        className: '',
        html: pinHtml(theme.brandColor, logoUrl),
        iconSize: [46, 56],
        iconAnchor: [23, 56],
        popupAnchor: [0, -52],
      })

      const latlngs: Array<[number, number]> = []
      for (const p of pins) {
        const ll: [number, number] = [p.latitude, p.longitude]
        latlngs.push(ll)
        const addr = p.address
          ? `<div style="color:#677084;margin-top:2px;">${escapeHtml(p.address)}</div>`
          : ''
        // Coordinates come from `branches.latitude/longitude` (numeric)
        // — safe to interpolate as-is, no escaping needed for a URL.
        const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`
        const directionsLink = `<a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:8px;font-weight:500;text-decoration:none;color:${escapeHtml(theme.brandColor)};">Buka di Google Maps →</a>`
        L.marker(ll, { icon })
          .addTo(map!)
          .bindPopup(
            `<div style="font-weight:600;">${escapeHtml(p.name)}</div>${addr}${directionsLink}`,
          )
      }

      if (latlngs.length === 1) {
        map.setView(latlngs[0]!, 16)
      } else {
        map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40] })
      }
      // Container size can settle after mount (esp. the editor preview
      // pane) — recalculate so tiles aren't left half-drawn.
      map.invalidateSize()
    })

    return () => {
      cancelled = true
      if (map) map.remove()
    }
  }, [pins, theme.brandColor, logoUrl, mapProvider])

  if (data.branches.length === 0) return null

  // No branch has coordinates yet — surface an authoring hint in the
  // editor, render nothing on the live site.
  if (pins.length === 0) {
    if (!isEditorPreview) return null
    return (
      <section className="bg-gray-50 py-12 dark:bg-gray-950">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900">
            Belum ada cabang dengan koordinat lokasi. Atur lokasi cabang
            (latitude &amp; longitude) agar peta bisa tampil.
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="bg-gray-50 py-12 sm:py-16 lg:py-20 dark:bg-gray-950">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 text-center sm:mb-8">
          <div
            className="mx-auto mb-3 h-1 w-12 rounded-full sm:mb-4"
            style={{ backgroundColor: theme.brandColor }}
          />
          <h2 className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight text-gray-900 sm:gap-3 sm:text-3xl lg:text-4xl dark:text-gray-100">
            <MapPin
              className="h-6 w-6 sm:h-7 sm:w-7"
              style={{ color: theme.brandColor }}
            />
            {heading}
          </h2>
        </div>

        <div className="overflow-hidden rounded-2xl shadow-md">
          {mapProvider === 'google' && googleBranch ? (
            <iframe
              src={`https://maps.google.com/maps?q=${googleBranch.latitude},${googleBranch.longitude}&z=16&output=embed`}
              className="block h-[340px] w-full sm:h-[420px] lg:h-[480px]"
              style={{ border: 0 }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title={heading}
              allowFullScreen
            />
          ) : (
            <div
              ref={mapRef}
              className="h-[340px] w-full bg-gray-100 sm:h-[420px] lg:h-[480px] dark:bg-gray-800"
            />
          )}
        </div>

        {/* Address list — doubles as the no-JS / SEO fallback and gives
            visitors a one-tap "open in Google Maps" directions link. */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {pins.map((b) => (
            <div
              key={b.id}
              className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm dark:bg-gray-900"
            >
              <MapPin
                className="mt-0.5 h-5 w-5 shrink-0"
                style={{ color: theme.brandColor }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {b.name}
                </p>
                {b.address && (
                  <p className="mt-0.5 text-xs text-gray-500">{b.address}</p>
                )}
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${b.latitude},${b.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium hover:underline"
                  style={{ color: theme.brandColor }}
                >
                  Buka di Google Maps
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export const mapsSection: SectionDef = {
  type: 'maps',
  name: 'Peta Lokasi',
  description: 'Peta lokasi cabang dengan penanda logo.',
  icon: 'MapPin',
  allowMultiple: false,
  defaultSettings: {
    heading: 'Lokasi',
    mapProvider: 'leaflet',
    branchIds: [],
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Lokasi',
    },
    {
      key: 'mapProvider',
      type: 'select',
      label: 'Jenis peta',
      help: 'Leaflet (OpenStreetMap): semua cabang dalam satu peta + penanda logo, gratis. Google Maps: tampilan peta lebih familiar, tapi hanya menampilkan SATU cabang dan tanpa penanda logo.',
      options: [
        { value: 'leaflet', label: 'Leaflet — semua cabang + logo' },
        { value: 'google', label: 'Google Maps — satu cabang' },
      ],
      default: 'leaflet',
    },
    {
      key: 'branchIds',
      type: 'branchMultiSelect',
      label: 'Cabang yang ditampilkan',
      help: 'Centang cabang yang ingin ditampilkan. Kosongkan untuk menampilkan semua cabang. Mode Google Maps hanya menampilkan satu cabang (cabang utama).',
    },
  ],
  Render: MapsRender,
}
