import * as React from 'react'
import { cn } from '@/lib/utils'

interface RevealProps {
  children: React.ReactNode
  /** Delay in ms before fade-in kicks in (handy for staggered siblings). */
  delay?: number
  /** Negative values trigger reveal slightly before full intersection. */
  rootMargin?: string
  /** Once visible, stop observing — reveal is one-shot. */
  once?: boolean
  className?: string
}

/**
 * Lightweight scroll-driven fade-in. Uses IntersectionObserver to detect
 * when the wrapped block enters the viewport, then toggles Tailwind
 * opacity + translate utilities to ease it in.
 *
 * Why Tailwind utilities instead of attribute-selector CSS: the prior
 * approach quietly broke when the observer fired synchronously on
 * hydration — there was no paint frame at opacity:0 before the flip,
 * so the transition had nothing to animate from. Toggling classes
 * inside React + a one-frame `requestAnimationFrame` guarantees the
 * browser commits the "before" state once before we flip to "after".
 *
 * Respects `prefers-reduced-motion`: SSR-rendered children stay
 * visible if the API is missing, and we skip animation entirely when
 * the OS preference is set.
 */
export function Reveal({
  children,
  delay = 0,
  rootMargin = '0px 0px -10% 0px',
  once = true,
  className,
}: RevealProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  // Start VISIBLE so SSR and the first client paint show the content
  // immediately — no blank screen while the JS bundle downloads on slow
  // connections (this previously caused a ~5s blank first paint / 4.8s FCP
  // on mobile 4G, since every wrapped block was rendered at opacity:0 until
  // hydration). The effect below only re-hides + animates blocks that mount
  // BELOW the fold, where the user never sees the flip; above-the-fold
  // content just stays put.
  const [visible, setVisible] = React.useState(true)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    // No observer support → leave content visible (no animation).
    if (typeof IntersectionObserver === 'undefined') return

    // Reduced-motion users keep the content visible, no animation.
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    if (reducedMotion) return

    // Already on screen at mount (above the fold) → keep it visible.
    // Animating from opacity:0 here is exactly what blanked the page.
    const rect = el.getBoundingClientRect()
    const inViewAtMount = rect.top < window.innerHeight && rect.bottom > 0
    if (inViewAtMount) return

    // Below the fold: hide now (off-screen, so the flip isn't visible) and
    // let the observer ease it in when the user scrolls down to it.
    setVisible(false)

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // rAF guarantees the "hidden" state has been committed to
            // the screen at least once, so the transition has a real
            // "from" frame to interpolate.
            requestAnimationFrame(() => setVisible(true))
            if (once) observer.unobserve(entry.target)
          } else if (!once) {
            setVisible(false)
          }
        }
      },
      { rootMargin, threshold: 0 },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin, once])

  return (
    <div
      ref={ref}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        'transition-all duration-1000 ease-out motion-reduce:transition-none',
        // Larger slide + a touch of scale so the reveal reads as a
        // proper "rise into place" instead of a faint nudge.
        visible
          ? 'translate-y-0 scale-100 opacity-100'
          : 'translate-y-16 scale-95 opacity-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
