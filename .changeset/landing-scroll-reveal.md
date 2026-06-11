---
"@vintra/web": patch
---

Add scroll-driven fade-in animation to landing page sections.

New `<Reveal>` wrapper at `apps/web/src/components/layout/reveal.tsx` uses IntersectionObserver to ease each section into view as it scrolls into the viewport — slide-up 64px + scale 95→100% + opacity fade over 1s. Wraps every landing section except the hero (kept eager so above-the-fold first paint isn't blanked).

Honors `prefers-reduced-motion: reduce` and uses `requestAnimationFrame` to guarantee a paint frame at the hidden state before flipping, so the transition has something real to interpolate from on hydration.
