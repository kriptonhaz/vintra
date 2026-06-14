/**
 * Hero — the marquee section. Three layouts:
 *   - 'image-bg': Photo background carousel (max 3), text overlaid
 *   - 'color-bg': Brand-color flat or gradient background, large centered text
 *   - 'split':    Photo on right (desktop) / top (mobile), text on left
 *
 * Image-bg + split use a small carousel (`heroImages` repeater, max 3
 * entries). Carousel auto-advances when `carouselAutoSlide` is on,
 * with a configurable `carouselDurationSec`. Single image works fine
 * — no dots, no auto-slide, just static.
 *
 * Generous padding (py-20 / py-28), loud typography (text-4xl→text-6xl),
 * unambiguous CTA. Mobile-first throughout.
 */
import { useEffect, useState } from 'react'
import { ArrowRight, MessageCircle, MapPin } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'

type HeroImageEntry = {
  imageAssetKey?: string | null
  alt?: string
}

function resolveImages(
  raw: unknown,
  legacyKey: unknown,
  resolveAssetUrl: (key: string | null | undefined) => string | null,
): Array<{ url: string; alt: string }> {
  const out: Array<{ url: string; alt: string }> = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const i = item as HeroImageEntry
        const url = resolveAssetUrl(i.imageAssetKey ?? null)
        if (url) out.push({ url, alt: i.alt?.trim() || '' })
      }
    }
  }
  // Backwards compat: tenants on the pre-carousel shape stored a single
  // `heroImageAssetKey`. Surface it as the first slide so their page
  // doesn't go blank on the renderer upgrade.
  if (out.length === 0 && typeof legacyKey === 'string') {
    const url = resolveAssetUrl(legacyKey)
    if (url) out.push({ url, alt: '' })
  }
  return out
}

function useCarousel(
  total: number,
  autoSlide: boolean,
  durationSec: number,
) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (total <= 1 || !autoSlide) return
    const ms = Math.max(2, durationSec) * 1000
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % total)
    }, ms)
    return () => clearInterval(t)
  }, [total, autoSlide, durationSec])
  return { index, setIndex }
}

function HeroRender({ data, settings, theme, resolveAssetUrl }: SectionRenderProps) {
  const rawLayout = (settings.layout as string) ?? 'color-bg'
  const heading =
    (settings.heading as string)?.trim() || data.tenant.businessName
  const tagline = (settings.tagline as string)?.trim() ?? ''
  const ctaText = (settings.ctaText as string)?.trim() || ''
  const ctaAction = (settings.ctaAction as string) ?? 'whatsapp'
  const overlayDim = settings.overlayDim !== false
  // Text-overlay toggles — let tenants whose hero photo already has
  // baked-in text hide the auto heading + address so it doesn't clash.
  const showHeading = settings.showHeading !== false
  const showAddress = settings.showAddress !== false

  const images = resolveImages(
    settings.heroImages,
    settings.heroImageAssetKey,
    resolveAssetUrl,
  )

  // Principle of least surprise: a tenant who uploaded a hero image
  // expects to see it. The default `color-bg` layout used to silently
  // ignore uploaded images — auto-promote to `image-bg` whenever a
  // photo exists so the upload "just works." If they truly want a
  // text-only hero, they'll either leave the slot empty or pick
  // `color-bg` after removing photos.
  const layout =
    rawLayout === 'color-bg' && images.length > 0 ? 'image-bg' : rawLayout
  const autoSlide = settings.carouselAutoSlide !== false
  const durationSec = (() => {
    // The select option emits string values; tolerate either shape.
    const raw = settings.carouselDurationSec
    const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? '5'))
    return Number.isFinite(n) && n > 0 ? n : 5
  })()

  const waNumber = (settings.waNumber as string)?.replace(/\D/g, '') ?? ''
  const waMessage = (settings.waMessage as string) ?? ''
  const ctaHref =
    ctaAction === 'whatsapp' && waNumber
      ? `https://wa.me/${waNumber}${waMessage ? `?text=${encodeURIComponent(waMessage)}` : ''}`
      : ctaAction === 'scroll-services'
        ? '#services'
        : ctaAction === 'scroll-contact'
          ? '#contact'
          : null
  // JUR-176 follow-up: render the button whenever the tenant filled in
  // CTA text, even if the action target is unreachable. Falling back
  // to '#' would silently no-op (vs. the previous code which hid the
  // button — which left tenants wondering why their button vanished).
  const shouldRenderCta = ctaText.length > 0
  const ctaHrefSafe = ctaHref ?? '#'
  const ctaOpensExternal = ctaAction === 'whatsapp'

  const mainBranch = data.branches.find((b) => b.isMain) ?? data.branches[0] ?? null

  // ─── image-bg layout ───────────────────────────────────────────────
  if (layout === 'image-bg' && images.length > 0) {
    return (
      <section className="relative overflow-hidden">
        <HeroCarousel
          images={images}
          autoSlide={autoSlide}
          durationSec={durationSec}
          overlayDim={overlayDim}
        />
        <div className="relative mx-auto max-w-5xl px-4 py-20 text-center text-white sm:px-6 sm:py-28 lg:py-36">
          {showHeading && (
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              {heading}
            </h1>
          )}
          {tagline && (
            <p className="mx-auto mt-5 max-w-2xl text-base text-white/90 sm:mt-6 sm:text-lg">
              {tagline}
            </p>
          )}
          {showAddress && mainBranch?.address && (
            // Wrap in a block <div> — without it the inline-flex <p>
            // and the inline-flex CTA below try to share a single line
            // and visually overlap.
            <div className="mt-3">
              <p className="inline-flex items-center gap-1.5 text-xs text-white/80 sm:text-sm">
                <MapPin className="h-3.5 w-3.5" />
                {mainBranch.address}
              </p>
            </div>
          )}
          {shouldRenderCta && (
            <div className="mt-8 sm:mt-10">
              <a
                href={ctaHrefSafe}
                target={ctaOpensExternal ? '_blank' : undefined}
                rel={ctaOpensExternal ? 'noopener noreferrer' : undefined}
                className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold shadow-2xl transition hover:scale-105 sm:px-8 sm:py-4 sm:text-base"
                style={{ backgroundColor: theme.brandColor, color: 'white' }}
              >
                {ctaAction === 'whatsapp' && <MessageCircle className="h-5 w-5" />}
                {ctaText}
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>
      </section>
    )
  }

  // ─── split layout ──────────────────────────────────────────────────
  if (layout === 'split' && images.length > 0) {
    return (
      <section className="relative overflow-hidden bg-white dark:bg-gray-900">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 sm:gap-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
          <div className="order-2 lg:order-1">
            <div
              className="mb-4 inline-block h-1 w-12 rounded-full"
              style={{ backgroundColor: theme.brandColor }}
            />
            {showHeading && (
              <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl dark:text-gray-100">
                {heading}
              </h1>
            )}
            {tagline && (
              <p className="mt-4 text-base text-gray-600 sm:mt-5 sm:text-lg dark:text-gray-400">
                {tagline}
              </p>
            )}
            {showAddress && mainBranch?.address && (
              <div className="mt-3">
                <p className="inline-flex items-center gap-1.5 text-xs text-gray-500 sm:text-sm">
                  <MapPin className="h-4 w-4" />
                  {mainBranch.address}
                </p>
              </div>
            )}
            {shouldRenderCta && (
              <div className="mt-6 sm:mt-8">
                <a
                  href={ctaHrefSafe}
                  target={ctaOpensExternal ? '_blank' : undefined}
                  rel={ctaOpensExternal ? 'noopener noreferrer' : undefined}
                  className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 sm:px-6 sm:py-3.5 sm:text-base"
                  style={{ backgroundColor: theme.brandColor }}
                >
                  {ctaAction === 'whatsapp' && <MessageCircle className="h-4 w-4" />}
                  {ctaText}
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            )}
          </div>
          <div className="relative order-1 lg:order-2">
            <div className="overflow-hidden rounded-2xl shadow-2xl sm:rounded-3xl">
              <HeroCarousel
                images={images}
                autoSlide={autoSlide}
                durationSec={durationSec}
                overlayDim={false}
                aspectClass="aspect-[4/3]"
              />
            </div>
            <div
              className="absolute -bottom-6 -left-6 -z-10 hidden h-40 w-40 rounded-full opacity-30 blur-3xl lg:block"
              style={{ backgroundColor: theme.brandColor }}
            />
          </div>
        </div>
      </section>
    )
  }

  // ─── color-bg fallback ─────────────────────────────────────────────
  return (
    <section
      className="relative overflow-hidden text-white"
      style={{
        backgroundImage: `linear-gradient(135deg, ${theme.brandColor} 0%, ${theme.brandColor}dd 50%, ${theme.brandColor}aa 100%)`,
      }}
    >
      <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
      <div className="relative mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 sm:py-24 lg:py-32">
        {showHeading && (
          <h1 className="text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            {heading}
          </h1>
        )}
        {tagline && (
          <p className="mx-auto mt-5 max-w-2xl text-base text-white/90 sm:mt-6 sm:text-lg lg:text-xl">
            {tagline}
          </p>
        )}
        {showAddress && mainBranch?.address && (
          <div className="mt-3">
            <p className="inline-flex items-center gap-1.5 text-xs text-white/80 sm:text-sm">
              <MapPin className="h-4 w-4" />
              {mainBranch.address}
            </p>
          </div>
        )}
        {shouldRenderCta && (
          <div className="mt-8 sm:mt-10">
            <a
              href={ctaHrefSafe}
              target={ctaOpensExternal ? '_blank' : undefined}
              rel={ctaOpensExternal ? 'noopener noreferrer' : undefined}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-sm font-semibold shadow-2xl transition hover:scale-105 sm:px-8 sm:py-4 sm:text-base"
              style={{ color: theme.brandColor }}
            >
              {ctaAction === 'whatsapp' && <MessageCircle className="h-5 w-5" />}
              {ctaText}
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Carousel ────────────────────────────────────────────────────────

function HeroCarousel({
  images,
  autoSlide,
  durationSec,
  overlayDim,
  aspectClass,
}: {
  images: Array<{ url: string; alt: string }>
  autoSlide: boolean
  durationSec: number
  overlayDim: boolean
  /** Optional aspect-ratio container — for split layout. Image-bg uses
   *  absolute positioning so it fills its section instead. */
  aspectClass?: string
}) {
  const { index, setIndex } = useCarousel(images.length, autoSlide, durationSec)
  const isSingle = images.length <= 1
  const positioning = aspectClass
    ? `relative w-full ${aspectClass}`
    : 'absolute inset-0 h-full w-full'

  return (
    <div className={positioning}>
      {/* Cross-fade transition — opacity per slide. Avoids the layout-
          shift that a transform-translate carousel would cause when the
          parent container has fixed height. */}
      {images.map((img, i) => (
        <img
          key={i}
          src={img.url}
          alt={img.alt || ''}
          // The first slide is the above-the-fold LCP image — load it
          // eagerly with a high priority hint. Remaining carousel
          // slides aren't visible at first paint, so defer them.
          loading={i === 0 ? 'eager' : 'lazy'}
          fetchPriority={i === 0 ? 'high' : 'auto'}
          decoding="async"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${
            i === index ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
      {overlayDim && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/70" />
      )}
      {!isSingle && (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Slide ${i + 1}`}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/50 hover:bg-white/80'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Schema ──────────────────────────────────────────────────────────

export const heroSection: SectionDef = {
  type: 'hero',
  name: 'Hero',
  description: 'Bagian paling atas — nama usaha, tagline, dan tombol utama.',
  icon: 'Sparkles',
  allowMultiple: false,
  defaultSettings: {
    layout: 'color-bg',
    heading: '',
    tagline: '',
    ctaText: 'Hubungi Kami',
    ctaAction: 'whatsapp',
    waNumber: '',
    waMessage: 'Halo, saya tertarik dengan layanan Anda.',
    heroImages: [],
    carouselAutoSlide: true,
    carouselDurationSec: 5,
    overlayDim: true,
    showHeading: true,
    showAddress: true,
  },
  fields: [
    {
      key: 'layout',
      type: 'select',
      label: 'Tampilan',
      help: 'Image-bg + split butuh foto. Color-bg pakai warna brand saja.',
      options: [
        { value: 'color-bg', label: 'Warna brand penuh' },
        { value: 'image-bg', label: 'Foto besar dengan teks di atas' },
        { value: 'split', label: 'Teks kiri, foto kanan' },
      ],
      default: 'color-bg',
    },
    {
      key: 'heroImages',
      type: 'repeater',
      label: 'Foto hero',
      itemLabel: 'Foto',
      help:
        'Maksimal 3 foto. Jika lebih dari 1, akan tampil sebagai carousel. Mengunggah foto otomatis mengubah tampilan menjadi "Foto besar" — meski sebelumnya dipilih "Warna brand penuh" (yang tidak menampilkan foto).',
      max: 3,
      fields: [
        {
          key: 'imageAssetKey',
          type: 'image',
          label: 'Foto',
          uploadKind: 'hero',
          aspectHint: '16:9',
          maxKB: 500,
        },
        {
          key: 'alt',
          type: 'text',
          label: 'Caption / alt-text (opsional)',
          maxLen: 80,
        },
      ],
    },
    {
      key: 'carouselAutoSlide',
      type: 'toggle',
      label: 'Auto-slide carousel',
      help: 'Hanya aktif jika lebih dari 1 foto.',
      default: true,
    },
    {
      key: 'carouselDurationSec',
      type: 'select',
      label: 'Durasi per slide',
      help: 'Detik antar slide saat auto-slide aktif.',
      options: [
        { value: '3', label: '3 detik (cepat)' },
        { value: '5', label: '5 detik (default)' },
        { value: '7', label: '7 detik' },
        { value: '10', label: '10 detik (lambat)' },
      ],
      default: '5',
    },
    {
      key: 'showHeading',
      type: 'toggle',
      label: 'Tampilkan judul di atas foto',
      help: 'Matikan jika foto hero sudah memuat teks sendiri, agar tidak bertumpuk.',
      default: true,
    },
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      help: 'Kosongkan untuk pakai nama usaha otomatis. Diabaikan jika "Tampilkan judul" dimatikan.',
      maxLen: 80,
      placeholder: 'Selamat datang di…',
    },
    {
      key: 'showAddress',
      type: 'toggle',
      label: 'Tampilkan alamat',
      help: 'Tampilkan alamat cabang utama di bawah judul.',
      default: true,
    },
    {
      key: 'tagline',
      type: 'textarea',
      label: 'Tagline',
      help: 'Kalimat pendek di bawah judul.',
      maxLen: 160,
      rows: 2,
    },
    {
      key: 'ctaText',
      type: 'text',
      label: 'Teks tombol',
      help: 'Kosongkan untuk menyembunyikan tombol.',
      maxLen: 30,
      default: 'Hubungi Kami',
    },
    {
      key: 'ctaAction',
      type: 'select',
      label: 'Aksi tombol',
      options: [
        { value: 'whatsapp', label: 'Buka WhatsApp' },
        { value: 'scroll-services', label: 'Scroll ke layanan' },
        { value: 'scroll-contact', label: 'Scroll ke kontak' },
      ],
      default: 'whatsapp',
    },
    {
      key: 'waNumber',
      type: 'text',
      label: 'Nomor WhatsApp',
      help: 'Format 62xxxxxxxxxx tanpa tanda + atau -. Wajib jika aksi = WhatsApp.',
      placeholder: '6281234567890',
      maxLen: 20,
    },
    {
      key: 'waMessage',
      type: 'textarea',
      label: 'Template pesan WhatsApp',
      maxLen: 200,
      rows: 2,
      default: 'Halo, saya tertarik dengan layanan Anda.',
    },
    {
      key: 'overlayDim',
      type: 'toggle',
      label: 'Gelapkan foto agar teks terbaca',
      help: 'Hanya berlaku untuk tampilan "Foto besar".',
      default: true,
    },
  ],
  Render: HeroRender,
}
