/**
 * CTA Banner — full-width call-to-action band between content sections.
 * Useful for nudging visitors mid-page ("Lihat promo terbaru" /
 * "Pesan untuk grup"). Different from the bottom contact section in
 * that this is contextual, not a footer.
 */
import { ArrowRight, MessageCircle } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'

function CtaBannerRender({ settings, theme }: SectionRenderProps) {
  const heading = (settings.heading as string)?.trim() ?? ''
  if (!heading) return null

  const subtext = (settings.subtext as string)?.trim() ?? ''
  const ctaText = (settings.ctaText as string)?.trim() || 'Selengkapnya'
  const action = (settings.action as string) ?? 'whatsapp'
  const waNumber = (settings.waNumber as string)?.replace(/\D/g, '') ?? ''
  const waMessage = (settings.waMessage as string) ?? ''
  const customUrl = (settings.customUrl as string)?.trim() ?? ''
  const ctaHref =
    action === 'whatsapp' && waNumber
      ? `https://wa.me/${waNumber}${waMessage ? `?text=${encodeURIComponent(waMessage)}` : ''}`
      : action === 'url' && customUrl
        ? customUrl
        : null

  const style = (settings.style as string) ?? 'brand'

  if (style === 'minimal') {
    return (
      <section className="bg-white py-8 sm:py-12 dark:bg-gray-900">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div
            className="flex flex-col items-center gap-4 rounded-2xl border-2 p-5 text-center sm:flex-row sm:justify-between sm:rounded-3xl sm:p-8 sm:text-left"
            style={{ borderColor: theme.brandColor }}
          >
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-gray-900 sm:text-xl dark:text-gray-100">
                {heading}
              </h3>
              {subtext && (
                <p className="mt-1 text-xs text-gray-600 sm:text-sm dark:text-gray-400">
                  {subtext}
                </p>
              )}
            </div>
            {ctaHref && (
              <a
                href={ctaHref}
                target={action === 'whatsapp' || action === 'url' ? '_blank' : undefined}
                rel={action === 'whatsapp' || action === 'url' ? 'noopener noreferrer' : undefined}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                style={{ backgroundColor: theme.brandColor }}
              >
                {action === 'whatsapp' && <MessageCircle className="h-4 w-4" />}
                {ctaText}
                <ArrowRight className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section
      className="relative overflow-hidden py-12 sm:py-16"
      style={{
        backgroundImage: `linear-gradient(135deg, ${theme.brandColor}, ${theme.brandColor}dd)`,
      }}
    >
      <div className="relative mx-auto max-w-4xl px-4 text-center text-white sm:px-6 lg:px-8">
        <h3 className="text-xl font-bold sm:text-2xl lg:text-3xl">{heading}</h3>
        {subtext && (
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/90 sm:mt-3 sm:text-base">{subtext}</p>
        )}
        {ctaHref && (
          <a
            href={ctaHref}
            target={action === 'whatsapp' || action === 'url' ? '_blank' : undefined}
            rel={action === 'whatsapp' || action === 'url' ? 'noopener noreferrer' : undefined}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold shadow-xl transition hover:scale-105"
            style={{ color: theme.brandColor }}
          >
            {action === 'whatsapp' && <MessageCircle className="h-4 w-4" />}
            {ctaText}
            <ArrowRight className="h-4 w-4" />
          </a>
        )}
      </div>
    </section>
  )
}

export const ctaBannerSection: SectionDef = {
  type: 'cta-banner',
  name: 'Banner CTA',
  description: 'Pita penuh dengan ajakan bertindak. Bisa di tengah halaman.',
  icon: 'Megaphone',
  allowMultiple: true,
  defaultSettings: {
    heading: '',
    subtext: '',
    ctaText: 'Selengkapnya',
    action: 'whatsapp',
    waNumber: '',
    waMessage: '',
    customUrl: '',
    style: 'brand',
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 80,
      placeholder: 'Promo spesial bulan ini!',
    },
    {
      key: 'subtext',
      type: 'textarea',
      label: 'Subtext',
      maxLen: 160,
      rows: 2,
    },
    {
      key: 'style',
      type: 'select',
      label: 'Tampilan',
      options: [
        { value: 'brand', label: 'Latar warna brand' },
        { value: 'minimal', label: 'Outline minimalis' },
      ],
      default: 'brand',
    },
    {
      key: 'ctaText',
      type: 'text',
      label: 'Teks tombol',
      maxLen: 30,
      default: 'Selengkapnya',
    },
    {
      key: 'action',
      type: 'select',
      label: 'Aksi tombol',
      options: [
        { value: 'whatsapp', label: 'Buka WhatsApp' },
        { value: 'url', label: 'Buka URL custom' },
      ],
      default: 'whatsapp',
    },
    {
      key: 'waNumber',
      type: 'text',
      label: 'Nomor WhatsApp',
      help: 'Hanya dipakai jika aksi = WhatsApp.',
      maxLen: 20,
      placeholder: '6281234567890',
    },
    {
      key: 'waMessage',
      type: 'textarea',
      label: 'Template pesan WhatsApp',
      maxLen: 200,
      rows: 2,
    },
    {
      key: 'customUrl',
      type: 'url',
      label: 'URL custom',
      help: 'Dipakai jika aksi = URL custom. Mis. link Instagram, link form pendaftaran.',
      placeholder: 'https://…',
    },
  ],
  Render: CtaBannerRender,
}
