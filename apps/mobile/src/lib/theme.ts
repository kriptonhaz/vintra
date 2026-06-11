/**
 * Mobile design system — translated from the Google Stitch design.md spec.
 *
 * Philosophy: "Empowering Utility" for Indonesian businesses. Anchored by a
 * deep brand green (growth, financial health) with an energetic Action
 * Orange for high-priority CTAs. Backgrounds use a slight green-tinted
 * white (#F8FAF9) to reduce eye strain during long stock-management
 * sessions.
 *
 * MOBILE ONLY — the web has its own palette in app.css and is intentionally
 * not touched by this file.
 */

// ─── Colors ──────────────────────────────────────────────────────────
//
// Mirrors the Material 3 token names from design.md so future Stitch
// exports drop in cleanly. The `brand*` / `accent*` / status aliases at
// the bottom keep older callsites working — they map to the closest
// new-system token so the brand refresh propagates without a sweep.

export const COLORS = {
  // ── Surfaces (the off-white green-tinted background scale) ─────────
  background: '#f5fbf1',
  surface: '#f5fbf1',
  surfaceDim: '#d6dcd3',
  surfaceBright: '#f5fbf1',
  surfaceContainerLowest: '#ffffff',
  surfaceContainerLow: '#eff5ec',
  surfaceContainer: '#eaf0e6',
  surfaceContainerHigh: '#e4eae0',
  surfaceContainerHighest: '#dee4db',
  surfaceVariant: '#dee4db',
  surfaceSubtle: '#F8FAF9',
  surfaceTint: '#006d33',
  inverseSurface: '#2c322c',
  inverseOnSurface: '#ecf3e9',

  // ── On-surface text (high-contrast for outdoor glare) ──────────────
  onSurface: '#171d17',
  onSurfaceVariant: '#3e4a3f',
  onBackground: '#171d17',

  // ── Outlines (borders + dividers) ──────────────────────────────────
  outline: '#6e7a6e',
  outlineVariant: '#bdcabc',

  // ── Primary — Brand Green ────────────────────────────────────────
  primary: '#006b32',
  onPrimary: '#ffffff',
  primaryContainer: '#008741',
  onPrimaryContainer: '#f7fff3',
  inversePrimary: '#70dc8b',
  primaryFixed: '#8cf9a5',
  primaryFixedDim: '#70dc8b',
  onPrimaryFixed: '#00210b',
  onPrimaryFixedVariant: '#005225',

  // ── Secondary — Action Orange (high-priority CTAs only) ────────────
  secondary: '#9a4600',
  onSecondary: '#ffffff',
  secondaryContainer: '#fe8028',
  onSecondaryContainer: '#612900',
  secondaryFixed: '#ffdbc9',
  secondaryFixedDim: '#ffb68d',
  onSecondaryFixed: '#321200',
  onSecondaryFixedVariant: '#763300',

  // ── Tertiary — accent rose (rare; reports, promo highlights) ───────
  tertiary: '#a0364d',
  onTertiary: '#ffffff',
  tertiaryContainer: '#c04e64',
  onTertiaryContainer: '#fffbff',
  tertiaryFixed: '#ffd9dd',
  tertiaryFixedDim: '#ffb2bc',
  onTertiaryFixed: '#400012',
  onTertiaryFixedVariant: '#842038',

  // ── Semantic status colors ─────────────────────────────────────────
  success: '#148E47',
  warning: '#FFB800',
  danger: '#E53935',
  error: '#ba1a1a',
  onError: '#ffffff',
  errorContainer: '#ffdad6',
  onErrorContainer: '#93000a',

  // ── WhatsApp brand green (login button + chat bubble accent) ───────
  whatsappGreen: '#25D366',

  // ─── Legacy aliases (older callsites — DO NOT remove without sweep) ─
  //
  // Mapping rationale:
  //   brand        → primary             (brand green, swap is the brand refresh)
  //   brandDark    → onPrimaryFixedVariant (darker brand for hover)
  //   brandActive  → onPrimaryFixed      (deepest brand for pressed)
  //   brandTint    → primaryFixed        (light brand tint for badges)
  //   accent       → secondaryContainer  (Action Orange)
  //   accentTint   → secondaryFixed      (Action Orange tint)
  //   text         → onSurface
  //   textMuted    → onSurfaceVariant
  //   textSubtle   → outline
  //   textPlaceholder → outlineVariant
  //   surfaceMuted → surfaceContainerLow
  //   border       → outlineVariant
  //   borderSubtle → surfaceContainerHigh
  brand: '#006b32',
  brandDark: '#005225',
  brandActive: '#00210b',
  brandTint: '#8cf9a5',

  accent: '#fe8028',
  accentTint: '#ffdbc9',

  text: '#171d17',
  textMuted: '#3e4a3f',
  textSubtle: '#6e7a6e',
  textPlaceholder: '#bdcabc',

  surfaceMuted: '#eff5ec',
  border: '#bdcabc',
  borderSubtle: '#e4eae0',

  // Status tints — used by Pills/Chips
  dangerTint: '#ffdad6',
  warningTint: '#fff3cd',
  successTint: '#e6f4ea',
  info: '#3b82f6',
  infoTint: '#dbeafe',
} as const

// ─── Typography ──────────────────────────────────────────────────────
//
// Three functional roles, per design.md:
//   - Display (Manrope) — headlines, modern + tech-forward
//   - UI/Body (Inter) — body copy, labels, exceptional small-size legibility
//   - Data (JetBrains Mono) — Rupiah, stock counts, timestamps; aligns columns
//
// Font *files* are loaded in src/app/_layout.tsx via @expo-google-fonts.
// The string names below MUST match the exported font names from those
// packages — Expo registers them in the native font table under those
// exact identifiers.

export const FONTS = {
  // Display — Manrope. We load 600 + 700.
  headingBold: 'Manrope_700Bold',
  headingSemi: 'Manrope_600SemiBold',

  // Body — Inter. We load 400 / 500 / 600 / 700.
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',

  // Data — JetBrains Mono.
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const

/**
 * Pre-canned typography styles. Spread into RN Text/Tamagui props:
 *
 *   <Paragraph {...TYPE.bodyLg}>…</Paragraph>
 *
 * Sizes intentionally capped at 24px on the largest headline so
 * "above-the-fold" business data stays visible on small phones.
 */
export const TYPE = {
  headlineLg: {
    fontFamily: FONTS.headingBold,
    fontSize: 24,
    lineHeight: 32,
  },
  headlineMd: {
    fontFamily: FONTS.headingBold,
    fontSize: 20,
    lineHeight: 28,
  },
  headlineSm: {
    fontFamily: FONTS.headingSemi,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyLg: {
    fontFamily: FONTS.body,
    fontSize: 16,
    lineHeight: 24,
  },
  bodyMd: {
    fontFamily: FONTS.body,
    fontSize: 14,
    lineHeight: 20,
  },
  bodySm: {
    fontFamily: FONTS.body,
    fontSize: 12,
    lineHeight: 16,
  },
  /** Use for currency, stock counts, ISO timestamps. */
  labelData: {
    fontFamily: FONTS.monoMedium,
    fontSize: 14,
    lineHeight: 20,
  },
  /** Section eyebrows — uppercase letterspaced micro-labels. */
  eyebrow: {
    fontFamily: FONTS.bodyBold,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.55, // ~0.05em at 11px
    textTransform: 'uppercase' as const,
  },
} as const

// ─── Radii ──────────────────────────────────────────────────────────
//
// Cards + inputs: 8px (sm SaaS feel). Buttons + chips: pill / 24px+.
// Avatars: full (perfect circle).

export const RADII = {
  sm: 4,
  default: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const

// ─── Spacing (8px system) ───────────────────────────────────────────

export const SPACE = {
  marginMobile: 16,
  gutterMobile: 12,
  stackSm: 8,
  stackMd: 16,
  stackLg: 24,
} as const

// ─── Elevation (tonal layering + subtle tinted shadow) ──────────────
//
// Pass these into RN's `style` prop — Tamagui's `elevation` token
// applies a heavier shadow that doesn't match our spec.

export const SHADOWS = {
  /** Cards (level 1) — soft green-tinted, low opacity. */
  card: {
    shadowColor: '#0b3b1a',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  /** Floating overlays (level 2) — modals, popovers, snackbars. */
  floating: {
    shadowColor: '#0b3b1a',
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
} as const
