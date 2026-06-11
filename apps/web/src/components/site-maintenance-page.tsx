/**
 * JUR-176 follow-up: branded maintenance page for tenant public sites.
 *
 * Rendered by PublicSitePage when the tenant has flipped the
 * maintenance flag in their /site/edit. Picks up the brand color
 * from the last published settings (so the page still feels theirs)
 * + business name + the tenant's custom message (with a sensible
 * default in Bahasa Indonesia).
 *
 * Intentionally NO queue, services, gallery, or analytics — when
 * the tenant says "we're under construction", we should show that
 * and nothing else.
 */
import { Wrench, Sparkles } from 'lucide-react'

export function SiteMaintenancePage({
  businessName,
  customMessage,
  brandColor,
}: {
  businessName: string
  customMessage: string | null
  brandColor: string
}) {
  const message =
    customMessage && customMessage.trim().length > 0
      ? customMessage
      : 'Halaman publik usaha kami sedang diperbarui. Silakan kembali sebentar lagi — terima kasih atas pengertiannya!'

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center"
      style={{
        backgroundImage: `linear-gradient(135deg, ${brandColor}10 0%, ${brandColor}05 60%, transparent 100%)`,
      }}
    >
      <div className="w-full max-w-md">
        <div
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
          style={{ backgroundColor: brandColor }}
        >
          <Wrench className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">
          {businessName}
        </h1>
        <div
          className="mx-auto mt-4 h-1 w-12 rounded-full"
          style={{ backgroundColor: brandColor }}
        />
        <p className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold tracking-wider uppercase shadow-sm dark:bg-gray-800">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: brandColor }}
          />
          Sedang dalam perbaikan
        </p>
        <p className="mt-6 text-base leading-relaxed whitespace-pre-line text-gray-700 sm:text-lg dark:text-gray-300">
          {message}
        </p>
        <footer className="mt-12">
          <a
            href="https://vintra.my.id"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <Sparkles className="h-3 w-3" />
            Powered by Vintra
          </a>
        </footer>
      </div>
    </div>
  )
}
