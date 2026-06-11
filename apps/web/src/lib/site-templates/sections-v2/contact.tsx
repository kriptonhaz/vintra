/**
 * Contact — WhatsApp CTA + optional social links. Distinct from the
 * hero CTA because this lives at the bottom of the page (after the
 * tenant has shown what they offer, the visitor is ready to act).
 */
import { MessageCircle, Mail, Instagram, Phone } from 'lucide-react'
import type { SectionDef, SectionRenderProps } from '../v2-types'

function ContactRender({ settings, theme }: SectionRenderProps) {
  const heading = (settings.heading as string)?.trim() || 'Hubungi Kami'
  const tagline = (settings.tagline as string)?.trim() ?? ''
  const waNumber = (settings.waNumber as string)?.replace(/\D/g, '') ?? ''
  const waMessage = (settings.waMessage as string) ?? ''
  const email = (settings.email as string)?.trim() ?? ''
  const instagram = (settings.instagram as string)?.trim().replace(/^@/, '') ?? ''
  const phone = (settings.phone as string)?.trim() ?? ''

  const waHref = waNumber
    ? `https://wa.me/${waNumber}${waMessage ? `?text=${encodeURIComponent(waMessage)}` : ''}`
    : null

  if (!waHref && !email && !instagram && !phone) return null

  return (
    <section
      id="contact"
      className="relative overflow-hidden py-12 sm:py-20 lg:py-24"
      style={{
        backgroundImage: `linear-gradient(135deg, ${theme.brandColor}, ${theme.brandColor}cc)`,
      }}
    >
      <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
      <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
      <div className="relative mx-auto max-w-3xl px-4 text-center text-white sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">{heading}</h2>
        {tagline && (
          <p className="mx-auto mt-3 max-w-xl text-sm text-white/90 sm:mt-4 sm:text-base lg:text-lg">
            {tagline}
          </p>
        )}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          {waHref && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-semibold shadow-xl transition hover:scale-105 sm:w-auto"
              style={{ color: theme.brandColor }}
            >
              <MessageCircle className="h-5 w-5" />
              Chat via WhatsApp
            </a>
          )}
          {phone && (
            <a
              href={`tel:${phone}`}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border-2 border-white/30 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-white/10 sm:w-auto"
            >
              <Phone className="h-4 w-4" />
              {phone}
            </a>
          )}
        </div>
        <div className="mt-6 flex items-center justify-center gap-6 text-sm text-white/90">
          {email && (
            <a
              href={`mailto:${email}`}
              className="inline-flex items-center gap-1.5 hover:text-white"
            >
              <Mail className="h-4 w-4" />
              {email}
            </a>
          )}
          {instagram && (
            <a
              href={`https://instagram.com/${instagram}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-white"
            >
              <Instagram className="h-4 w-4" />@{instagram}
            </a>
          )}
        </div>
      </div>
    </section>
  )
}

export const contactSection: SectionDef = {
  type: 'contact',
  name: 'Kontak',
  description: 'Tombol WhatsApp + email + Instagram di bagian bawah halaman.',
  icon: 'MessageCircle',
  allowMultiple: false,
  defaultSettings: {
    heading: 'Hubungi Kami',
    tagline: 'Tim kami siap menjawab pertanyaan Anda.',
    waNumber: '',
    waMessage: 'Halo, saya tertarik dengan layanan Anda.',
    email: '',
    instagram: '',
    phone: '',
  },
  fields: [
    {
      key: 'heading',
      type: 'text',
      label: 'Judul',
      maxLen: 60,
      default: 'Hubungi Kami',
    },
    {
      key: 'tagline',
      type: 'textarea',
      label: 'Tagline',
      maxLen: 160,
      rows: 2,
      default: 'Tim kami siap menjawab pertanyaan Anda.',
    },
    {
      key: 'waNumber',
      type: 'text',
      label: 'Nomor WhatsApp',
      help: 'Format 62xxxxxxxxxx.',
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
      key: 'phone',
      type: 'text',
      label: 'Nomor telepon (opsional)',
      maxLen: 20,
      placeholder: '021-1234567',
    },
    {
      key: 'email',
      type: 'text',
      label: 'Email (opsional)',
      maxLen: 80,
      placeholder: 'kontak@usaha.com',
    },
    {
      key: 'instagram',
      type: 'text',
      label: 'Instagram handle (opsional)',
      help: 'Tanpa tanda @. Mis. "kopibenja".',
      maxLen: 40,
    },
  ],
  Render: ContactRender,
}
