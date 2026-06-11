import { Link } from '@tanstack/react-router'
import logoWithTextWhite from '@/assets/images/logo-with-text-white.png'

interface FooterLink {
  label: string
  href: string
  isInternal?: boolean
}

const FOOTER_LINKS: Record<string, FooterLink[]> = {
  // Produk anchors point at the landing page module-highlight sections.
  // POS + Manajemen Stok don't have their own highlight section yet —
  // they live as cards in the `#fitur` grid — so both land there for
  // now. Promote them to dedicated sections when those modules get
  // their own marketing pass.
  Produk: [
    { label: 'Kalkulator HPP', href: '/#hpp' },
    { label: 'Point of Sales', href: '/#fitur' },
    { label: 'Manajemen Stok', href: '/#fitur' },
    { label: 'Absensi Karyawan', href: '/#absensi' },
    { label: 'WhatsApp AI', href: '/#whatsapp' },
  ],
  // JUR-126: previously had Tentang Kami / Blog / Karir / Kontak +
  // Panduan Pengguna as href="#" stubs. Removed until the destination
  // pages exist — dead links erode trust on the public footer.
  // Pusat Bantuan now points at the real /help route (it exists, it
  // was just mis-wired before).
  Dukungan: [
    { label: 'Pusat Bantuan', href: '/help', isInternal: true },
    { label: 'Artikel & Panduan', href: '/artikel', isInternal: true },
    { label: 'Hubungi Kami', href: '/contact', isInternal: true },
    { label: 'Kebijakan Privasi', href: '/privacy', isInternal: true },
    { label: 'Syarat & Ketentuan', href: '/terms', isInternal: true },
  ],
}

export function LandingFooter() {
  return (
    <footer className="bg-gray-900 pt-16 pb-8">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-4">
          {/* Brand column */}
          <div className="lg:col-span-1">
            <div className="mb-4">
              <img
                src={logoWithTextWhite}
                alt="Vintra — All-in-one tools. Grow your business."
                width={398}
                height={127}
                loading="lazy"
                decoding="async"
                className="h-14 w-auto"
              />
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-gray-400">
              Platform bisnis all-in-one untuk bisnis modern di Indonesia.
              Kelola operasional usaha Anda secara lebih profesional.
            </p>
            {/* Social icons removed — we don't have official IG/TW/FB/YT
                accounts yet. Re-add when those exist. */}
          </div>

          {/* Link columns */}
          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title}>
              <h4 className="mb-4 text-sm font-semibold text-white">{title}</h4>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    {link.isInternal ? (
                      <Link
                        to={link.href}
                        className="text-sm text-gray-400 transition-colors hover:text-white"
                      >
                        {link.label}
                      </Link>
                    ) : (
                      <a
                        href={link.href}
                        className="text-sm text-gray-400 transition-colors hover:text-white"
                      >
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Legal entity — fills the 4th grid column */}
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Perusahaan</h4>
            <address className="text-sm not-italic leading-relaxed text-gray-400">
              PT. Beaver Teknologi Nusantara
              <br />
              Somewhere in Jakarta
            </address>
          </div>
        </div>

        {/* Copyright bar */}
        <div className="mt-12 border-t border-gray-800 pt-8 text-center">
          <p className="text-sm text-gray-500">
            &copy; {new Date().getFullYear()} Vintra. Semua hak dilindungi
            undang-undang.
          </p>
        </div>
      </div>
    </footer>
  )
}
