import * as React from 'react'
import { cn } from '@/lib/utils'

interface RevealProps {
  children: React.ReactNode
  /** Kept for API compatibility; no longer used. */
  delay?: number
  /** Kept for API compatibility; no longer used. */
  rootMargin?: string
  className?: string
}

/**
 * Plain passthrough wrapper (animation removed).
 *
 * This previously did a scroll-driven fade-in via opacity + transform
 * utilities. On iOS Safari that left every wrapped section as a GPU
 * compositing layer that the engine created but never painted — most
 * reliably reproduced with "Reduce Motion" enabled, where the reveal flips
 * to visible instantly with no animation to force a repaint. The result was
 * the entire landing page below the hero rendering blank on iPhones, while
 * working everywhere else (Android, desktop, default simulators).
 *
 * The hero section is not wrapped in Reveal and always painted correctly, so
 * the robust fix is to render the sections the same way: a plain, always-
 * visible element with no transform/opacity animation. No JS, no observer,
 * nothing that depends on hydration — so the content paints from the SSR
 * markup on every browser.
 */
export function Reveal({ children, className }: RevealProps) {
  return <div className={className ? cn(className) : undefined}>{children}</div>
}
