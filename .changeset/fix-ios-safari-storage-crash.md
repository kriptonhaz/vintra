---
"@vintra/web": patch
---

Fix the landing page rendering blank below the hero on iOS Safari for users with **Reduce Motion** enabled.

Root cause (confirmed by reproducing on a real iOS 26.5 simulator): the `Reveal` scroll-in animation wrapped every below-hero section in an element that animated `opacity`/`transform`. That promotes each section to a GPU compositing layer which iOS Safari creates but does **not paint** unless a repaint is forced. For normal users the reveal animation (transition + `requestAnimationFrame`) forced that repaint, so it painted. But users with **Reduce Motion** on flip straight to visible with `transition-none` — no animation, no repaint — so the layer was never painted and the entire page below the hero stayed blank. It only affected iPhones with Reduce Motion enabled, which is why it worked on Android, desktop, default simulators, and headless WebKit.

`Reveal` is now a plain passthrough (no opacity/transform animation), so sections render as ordinary content that always paints — exactly like the hero, which was never wrapped and never had the bug.

Additionally reduced the landing page's GPU/compositing load, which on real iPhones (not simulators) could exhaust the GPU/memory budget and drop below-fold section layers (blank / cut-off rendering): the decorative glow orbs now use a radial-gradient instead of a `blur-[120px]` filter, and two below-fold `backdrop-blur` usages were dropped.

Also included, from the same investigation:

- **`SlotText`** renders a plain static word during SSR/hydration and mounts the animated reel only afterward, so its complex reel markup can't cause a hydration mismatch on iOS. It also now rolls regardless of `prefers-reduced-motion` (consistent with the always-animating marquee strip).
- Hardened all `localStorage`/`sessionStorage` access behind a new `safe-storage` wrapper — iOS Safari throws a `SecurityError` on storage access under "Block All Cookies"/Private mode, and `ThemeProvider` read it synchronously during render. Routed theme, branch selector, onboarding tour, thermal printer, cashier, and the chunk-reload guard through the wrapper.
