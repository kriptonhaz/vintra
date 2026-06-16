import * as React from "react";
import { cn } from "@/lib/utils";

interface SlotTextProps {
  /** Words to cycle through. The first one renders on SSR / before hydration. */
  words: string[];
  /** ms each word stays before rolling to the next. */
  interval?: number;
  /** Extra classes for each word (e.g. gradient highlight). */
  wordClassName?: string;
  className?: string;
}

// useLayoutEffect warns on the server; fall back to useEffect there so the
// measurement pass stays warning-free during SSR.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

/**
 * Slot-machine "roll" text — the active word sits at rest while the next
 * one rolls up from below and the previous one rolls out the top, like a
 * reel ticking over. Pure CSS transforms, zero dependencies (inspired by
 * textmotion.dev's slot-text).
 *
 * The slot shrinks to fit the *current* word and animates its width as the
 * reel turns, so any text after it on the line tucks right up against the
 * word and glides along instead of leaving a gap sized to the widest word.
 *
 * - An in-flow, `visibility:hidden` sizer reserves the line height and gives
 *   a correct intrinsic width before JS measures (SSR / first paint).
 * - Off-screen measurer spans report each word's pixel width so the wrapper
 *   can animate `width` between them.
 *
 * SSR-safe: index starts at 0 on both server and first client paint, so
 * there's no hydration mismatch. The interval only starts in an effect, after
 * mount. It rolls regardless of `prefers-reduced-motion` (matching the
 * marquee strip).
 */
export function SlotText({
  words,
  interval = 2200,
  wordClassName,
  className,
}: SlotTextProps) {
  const [index, setIndex] = React.useState(0);
  const measurers = React.useRef<(HTMLSpanElement | null)[]>([]);
  const [widths, setWidths] = React.useState<number[]>([]);

  // The server and the first client paint render a PLAIN static word (see the
  // early return below). The slot-reel markup — absolutely-positioned
  // measurer spans + a stack of transformed reel spans — only mounts after
  // hydration. Why: that structure hydrated inconsistently on iOS Safari 26,
  // throwing "Hydration failed because the server rendered HTML didn't match
  // the client", which wedged React (no effects ran) and blanked the entire
  // page below the hero. Keeping the hydrated HTML trivially simple makes a
  // mismatch impossible; the animation is purely a post-hydration enhancement.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Measure each word's rendered width, and re-measure when the reel mounts,
  // the webfont finishes loading, or the viewport changes the font size.
  useIsoLayoutEffect(() => {
    if (!mounted) return;
    const measure = () =>
      setWidths(
        measurers.current.map((el) =>
          el ? el.getBoundingClientRect().width : 0,
        ),
      );
    measure();

    let cancelled = false;
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    window.addEventListener("resize", measure);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
    };
  }, [words.join("|"), mounted]);

  React.useEffect(() => {
    if (!mounted) return;
    if (words.length <= 1) return;

    // Rolls regardless of `prefers-reduced-motion` — kept consistent with the
    // marquee strip, which also always animates. (The animation is a small,
    // GPU-cheap text transform, not a motion-sickness risk like parallax.)
    const id = setInterval(
      () => setIndex((i) => (i + 1) % words.length),
      interval,
    );
    return () => clearInterval(id);
  }, [words.length, interval, mounted]);

  const measuredWidth = widths[index];

  // SSR + first client paint: a plain inline word. Identical on server and
  // client, so hydration can't mismatch. The animated reel below replaces it
  // after mount. `words[0]` is also the reel's resting word, so there's no
  // visible jump when the reel takes over.
  if (!mounted) {
    return (
      <span className={cn("whitespace-nowrap", wordClassName, className)}>
        {words[0]}
      </span>
    );
  }

  return (
    <span
      // `overflow: clip` + `overflow-clip-margin` extends the clip box
      // outward (so descenders like the "g" in Bengkel aren't cut) WITHOUT
      // adding layout height — line spacing stays put. The reel distance
      // below (150%) sends waiting words well past this margin so they
      // stay hidden during the roll.
      className={cn(
        "relative inline-block overflow-clip align-bottom transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
        className,
      )}
      style={{ overflowClipMargin: "0.5em", ...(measuredWidth ? { width: measuredWidth } : {}) }}
      aria-label={words[0]}
    >
      {/* In-flow sizer: reserves line height always, and the intrinsic
          width until JS measures (keeps SSR / first paint tight). */}
      <span aria-hidden className={cn("invisible whitespace-nowrap", wordClassName)}>
        {words[index]}
      </span>

      {/* Off-screen measurers — absolute so they don't affect layout. */}
      {words.map((word, i) => (
        <span
          key={`measure-${word}`}
          ref={(el) => {
            measurers.current[i] = el;
          }}
          aria-hidden
          className={cn(
            "pointer-events-none invisible absolute top-0 left-0 whitespace-nowrap",
            wordClassName,
          )}
        >
          {word}
        </span>
      ))}

      {/* The rolling reel. */}
      {words.map((word, i) => {
        // Where this word sits relative to the active one: at rest (0),
        // already rolled out the top (-1), or waiting below to roll in (+1).
        const offset = i === index ? 0 : i < index ? -1 : 1;
        return (
          <span
            key={word}
            aria-hidden={i !== index}
            // pb extends the box so a `background-clip: text` gradient still
            // paints the descender (g, j, p, y); with a tight line-height the
            // glyph otherwise dips below the box and renders transparent.
            className={cn(
              "absolute top-0 left-0 whitespace-nowrap pb-[0.35em] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]",
              wordClassName,
            )}
            style={{
              transform: `translateY(${offset * 150}%)`,
              opacity: offset === 0 ? 1 : 0,
            }}
          >
            {word}
          </span>
        );
      })}
    </span>
  );
}
