/**
 * Per-section background helper (Framer/WordPress-style).
 *
 * Sections that opt in expose a `bgColor` field. When the tenant sets a
 * hex color, the section renders that as its background instead of its
 * default surface. Text stays readable automatically: a dark custom
 * background gets `data-section-surface="dark"`, and a CSS rule in
 * app.css flips the standard gray text utilities to light tones.
 *
 * Unset / invalid → the section keeps its built-in default surface class
 * (zero regression).
 */
import type { CSSProperties } from 'react'

const HEX = /^#[0-9a-f]{6}$/i

/** True for backgrounds dark enough to need light text (sRGB luminance). */
export function isColorDark(hex: string): boolean {
  const m = HEX.exec(hex.trim())
  if (!m) return false
  const n = parseInt(m[0].slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum < 0.5
}

export type SectionBg = {
  /** Background utility classes — empty when a custom color is applied. */
  className: string
  style?: CSSProperties
  /** Set to 'dark' so app.css can flip descendant text to light. */
  surface?: 'dark'
}

/**
 * Resolve a section's background from its settings.
 *   - custom hex → inline backgroundColor (+ surface flag if dark)
 *   - otherwise → the provided default surface classes
 */
export function resolveSectionBg(
  settings: Record<string, unknown>,
  defaultClassName: string,
): SectionBg {
  const c = typeof settings.bgColor === 'string' ? settings.bgColor.trim() : ''
  if (!HEX.test(c)) return { className: defaultClassName }
  return isColorDark(c)
    ? { className: '', style: { backgroundColor: c }, surface: 'dark' }
    : { className: '', style: { backgroundColor: c } }
}

/** The reusable editor field. Spread into a section's `fields` array. */
export const BG_COLOR_FIELD = {
  key: 'bgColor',
  type: 'color' as const,
  label: 'Warna latar section',
  help: 'Kosongkan untuk pakai warna bawaan. Teks otomatis menyesuaikan agar tetap terbaca di latar gelap.',
}
