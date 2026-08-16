import { useState, useEffect, useCallback } from 'react'
import { Menu, X, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import logo from '@/assets/images/logo.png'
import logoWhite from '@/assets/images/logo-white.png'

interface NavLink {
  label: string
  href: string
}

interface LandingNavbarProps {
  navLinks?: NavLink[]
  /**
   * Visual tone of the floating bar. 'dark' renders ink glass for pages
   * with a dark hero (the landing page); 'light' (default) renders white
   * glass for the regular light public pages (/pricing, /help, …).
   */
  tone?: 'light' | 'dark'
}

// JUR-13: default nav links for public pages. The standalone /pricing
// page is hidden for now — pricing lives in the landing #harga section.
// Caller can override by passing `navLinks` prop.
const DEFAULT_NAV_LINKS: NavLink[] = [
  { label: 'Harga', href: '/#harga' },
  { label: 'Bantuan', href: '/help' },
  { label: 'Kontak', href: '/contact' },
]

export function LandingNavbar({
  navLinks = DEFAULT_NAV_LINKS,
  tone = 'light',
}: LandingNavbarProps) {
  const [scrolled, setScrolled] = useState(false)
  const [mobileNavMounted, setMobileNavMounted] = useState(false)
  const [mobileNavVisible, setMobileNavVisible] = useState(false)
  const dark = tone === 'dark'

  const openMobileNav = useCallback(() => {
    setMobileNavMounted(true)
    // rAF ensures the mounted DOM is painted before we trigger the transition
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setMobileNavVisible(true))
    })
  }, [])

  const closeMobileNav = useCallback(() => {
    setMobileNavVisible(false)
  }, [])

  const handleTransitionEnd = useCallback(() => {
    if (!mobileNavVisible) setMobileNavMounted(false)
  }, [mobileNavVisible])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Lock body scroll when mobile nav is open
  useEffect(() => {
    if (mobileNavMounted) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileNavMounted])

  return (
    <>
      {/* Floating glass bar — detached from the top edge so the page
          content shows through the blur, the way modern SaaS marketing
          sites treat their chrome. */}
      <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4">
        <div
          className={cn(
            'mx-auto flex max-w-7xl items-center justify-between rounded-2xl border px-4 py-2.5 backdrop-blur-xl transition-all duration-300 sm:px-5',
            dark
              ? 'border-white/10 bg-gray-950/60'
              : 'border-gray-200/70 bg-white/70',
            scrolled &&
              (dark
                ? 'border-white/15 bg-gray-950/85 shadow-lg shadow-black/20'
                : 'bg-white/90 shadow-lg shadow-gray-900/5'),
          )}
        >
          {/* Logo */}
          <a href="/" className="flex items-center gap-2.5">
            <img
              src={dark ? logoWhite : logo}
              alt="Vintra"
              width={32}
              height={32}
              decoding="async"
              className="h-8 w-8"
            />
            <span
              className={cn(
                'text-lg font-bold tracking-tight',
                dark ? 'text-white' : 'text-gray-900',
              )}
            >
              Vintra<span className="text-accent-500">.</span>
            </span>
          </a>

          {/* Desktop nav — only rendered when navLinks are provided */}
          {navLinks.length > 0 && (
            <nav className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    dark
                      ? 'text-gray-300 hover:bg-white/5 hover:text-white'
                      : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900',
                  )}
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}

          {/* Desktop CTA */}
          <div className="hidden items-center gap-2 md:flex">
            <a
              href="/auth/login"
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                dark
                  ? 'text-gray-300 hover:text-white'
                  : 'text-gray-600 hover:text-gray-900',
              )}
            >
              Masuk
            </a>
            <a
              href="/auth/register"
              className={cn(
                'group inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-all',
                dark
                  ? 'bg-brand-500 shadow-[0_0_20px_rgba(61,105,228,0.35)] hover:bg-brand-400'
                  : 'bg-brand-600 shadow-sm hover:bg-brand-700',
              )}
            >
              Mulai Gratis
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="md:hidden"
            onClick={openMobileNav}
            aria-label="Buka menu"
          >
            <Menu
              className={cn('h-6 w-6', dark ? 'text-gray-200' : 'text-gray-700')}
            />
          </button>
        </div>
      </header>

      {/* Mobile overlay drawer — rendered outside header to avoid stacking context issues */}
      {mobileNavMounted && (
        <div
          className="fixed inset-0 z-[100] md:hidden"
          onTransitionEnd={handleTransitionEnd}
        >
          {/* Backdrop */}
          <div
            className={cn(
              'absolute inset-0 bg-gray-950/60 backdrop-blur-sm transition-opacity duration-300',
              mobileNavVisible ? 'opacity-100' : 'opacity-0',
            )}
            onClick={closeMobileNav}
          />
          {/* Drawer panel */}
          <div
            className={cn(
              'absolute top-0 right-0 h-full w-72 rounded-l-2xl bg-white p-6 shadow-xl transition-transform duration-300 ease-out',
              mobileNavVisible ? 'translate-x-0' : 'translate-x-full',
            )}
          >
            <div className="mb-8 flex items-center justify-between">
              <span className="text-lg font-bold tracking-tight text-gray-900">
                Vintra<span className="text-accent-500">.</span>
              </span>
              <button
                type="button"
                onClick={closeMobileNav}
                aria-label="Tutup menu"
              >
                <X className="h-6 w-6 text-gray-500" />
              </button>
            </div>
            <nav className="flex flex-col gap-4">
              {navLinks.length > 0 &&
                navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="text-base font-medium text-gray-700 hover:text-brand-600"
                    onClick={closeMobileNav}
                  >
                    {link.label}
                  </a>
                ))}
              {navLinks.length > 0 && <hr className="my-2 border-gray-200" />}
              <a
                href="/auth/login"
                className="text-base font-medium text-gray-700 hover:text-gray-900"
              >
                Masuk
              </a>
              <a
                href="/auth/register"
                className="mt-2 rounded-lg bg-brand-600 px-5 py-3 text-center text-sm font-semibold text-white hover:bg-brand-700"
              >
                Mulai Gratis
              </a>
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
