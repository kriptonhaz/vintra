/**
 * JUR-13: Onboarding tour overlay.
 *
 * 5-step modal walkthrough that fires once on a first-time tenant's
 * dashboard visit. Each step is a card with title + body + "lanjut"
 * button + "lewati" + step indicator. Persistence is localStorage-keyed
 * by tenant id — no DB column required.
 *
 * Re-launchable: parent dashboard renders a "?" icon that calls
 * `startTour()` from the same hook to reopen even after dismissal.
 *
 * Why no react-joyride / shepherd: the tour is a sequence of
 * full-screen modals (not anchored tooltips), so the library overhead
 * isn't worth it. ~150 lines of plain React covers the whole flow.
 */
import * as React from 'react'
import { Link } from '@tanstack/react-router'
import {
  Calculator,
  Package,
  ChefHat,
  ShoppingCart,
  MessageCircle,
  X,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { safeLocalStorage } from '@/lib/safe-storage'

interface TourStep {
  icon: typeof Calculator
  title: string
  body: string
  /** When set, "Lanjut" button doubles as a deep-link to start the
   *  feature. Otherwise the button just advances. */
  ctaTo?: string
  ctaLabel?: string
}

const STEPS: TourStep[] = [
  {
    icon: Calculator,
    title: 'Mulai dari kalkulasi HPP biar tahu margin',
    body: 'HPP (harga pokok produksi) bantu kamu tahu untung tiap produk sebelum tetapin harga jual. Gratis dipakai semua tenant.',
    ctaTo: '/hpp',
    ctaLabel: 'Buka HPP',
  },
  {
    icon: Package,
    title: 'Atur inventaris item kamu',
    body: 'Item, unit, harga modal, harga jual per kuantitas (tier). Stok tercatat per cabang.',
    ctaTo: '/inventory/items',
    ctaLabel: 'Buka Inventaris',
  },
  {
    icon: ChefHat,
    title: 'Buat produk + resep',
    body: 'Hubungkan produk ke resep biar stok bahan otomatis berkurang tiap jualan. Cocok buat kafe / warung F&B.',
    ctaTo: '/hpp/products',
    ctaLabel: 'Buka Produk',
  },
  {
    icon: ShoppingCart,
    title: 'Coba cashier kasir',
    body: 'Tap produk, atur quantity, bayar. Sidebar otomatis collapse di kasir biar layar penuh dipakai.',
    ctaTo: '/pos/cashier',
    ctaLabel: 'Buka Kasir',
  },
  {
    icon: MessageCircle,
    title: 'Kirim struk via WhatsApp',
    body: 'Selesai transaksi → tap "Bagikan WA" → pelanggan terima ringkasan via WhatsApp. Atau cetak PDF buat printer thermal.',
  },
]

/** localStorage key prefix; suffixed with tenant id so each tenant's
 *  completion is tracked independently in the same browser. */
const TOUR_DONE_KEY = 'jq_onboarding_tour_done'

function tourKey(tenantId: string | null | undefined): string {
  return `${TOUR_DONE_KEY}:${tenantId ?? 'anonymous'}`
}

/**
 * Hook returning the tour open/close state + a manual `startTour`
 * trigger for the "?" header icon. Auto-opens on first dashboard
 * visit per (browser, tenant) until dismissed; the localStorage flag
 * sticks so the user doesn't get nagged on every reload.
 */
export function useOnboardingTour(tenantId: string | null | undefined) {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    if (!tenantId) return
    if (typeof window === 'undefined') return
    const done = safeLocalStorage.getItem(tourKey(tenantId))
    if (!done) {
      // Defer to next tick so the page paints first; the modal then
      // animates in cleanly instead of flashing on first frame.
      const t = setTimeout(() => setOpen(true), 400)
      return () => clearTimeout(t)
    }
  }, [tenantId])

  const dismissForever = React.useCallback(() => {
    if (tenantId) {
      safeLocalStorage.setItem(tourKey(tenantId), '1')
    }
    setOpen(false)
  }, [tenantId])

  const startTour = React.useCallback(() => setOpen(true), [])

  return { open, dismissForever, startTour }
}

interface Props {
  open: boolean
  onClose: () => void
}

export function OnboardingTour({ open, onClose }: Props) {
  const [step, setStep] = React.useState(0)

  React.useEffect(() => {
    if (open) setStep(0)
  }, [open])

  if (!open) return null
  const current = STEPS[step]!
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            <Icon className="h-6 w-6" />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
          {current.title}
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {current.body}
        </p>

        {/* Step pills */}
        <div className="mt-5 flex gap-1.5">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                i <= step ? 'bg-brand-600' : 'bg-gray-200 dark:bg-gray-700',
              )}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Lewati
          </button>
          <div className="flex items-center gap-2">
            {current.ctaTo && (
              <Link
                to={current.ctaTo}
                onClick={onClose}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                {current.ctaLabel ?? 'Buka'} <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            {isLast ? (
              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={onClose}
              >
                Mulai pakai Vintra
              </Button>
            ) : (
              <Button
                type="button"
                variant="brand"
                size="sm"
                onClick={() => setStep((s) => s + 1)}
              >
                Lanjut <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <p className="mt-3 text-center text-[11px] text-gray-400">
          Step {step + 1} dari {STEPS.length}
        </p>
      </div>
    </div>
  )
}
