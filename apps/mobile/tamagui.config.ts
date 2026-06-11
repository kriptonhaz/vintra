/**
 * Tamagui config — v3 preset + custom font families.
 *
 * Three font roles per the design system (see src/lib/theme.ts):
 *   - heading → Manrope (Display, modern + tech-forward)
 *   - body    → Inter   (UI/Body, exceptional small-size legibility)
 *   - mono    → JetBrains Mono (Data: currency, stock counts, timestamps)
 *
 * Font *files* are loaded in src/app/_layout.tsx via @expo-google-fonts.
 * The `family` strings here must match what useFonts registers.
 *
 * Colors are NOT overridden via Tamagui tokens — screens import the
 * canonical palette from src/lib/theme.ts (COLORS) and pass hex literals
 * to `bg`, `color`, etc. This keeps the design system single-sourced and
 * avoids re-deriving Tamagui's light/dark palette ramp from scratch just
 * to swap one brand hue.
 */
import { config } from '@tamagui/config/v3'
import { createFont, createTamagui } from 'tamagui'

// Manrope — heading scale. The size/lineHeight/letterSpacing ramps mirror
// Tamagui's preset $sizes so existing `<H1 size="$8">` callsites keep
// behaving sanely; the only change is the rendered face.
const headingFont = createFont({
  family: 'Manrope_700Bold',
  size: {
    1: 11, 2: 12, 3: 13, 4: 14, 5: 16, 6: 18, 7: 20, 8: 23, 9: 30,
    10: 38, 11: 46, 12: 55, 13: 62, 14: 72, 15: 92, 16: 114,
  },
  lineHeight: {
    1: 16, 2: 18, 3: 20, 4: 22, 5: 24, 6: 26, 7: 28, 8: 30, 9: 36,
    10: 44, 11: 52, 12: 62, 13: 70, 14: 82, 15: 102, 16: 124,
  },
  weight: { 4: '400', 6: '600', 7: '700' },
  letterSpacing: { 5: 0, 6: 0, 7: -0.2, 8: -0.4, 9: -0.6 },
  face: {
    600: { normal: 'Manrope_600SemiBold' },
    700: { normal: 'Manrope_700Bold' },
  },
})

// Inter — body scale. Lines tuned for legibility on dense data screens.
const bodyFont = createFont({
  family: 'Inter_400Regular',
  size: {
    1: 11, 2: 12, 3: 13, 4: 14, 5: 16, 6: 18, 7: 20, 8: 23, 9: 30,
  },
  lineHeight: {
    1: 14, 2: 16, 3: 18, 4: 20, 5: 24, 6: 26, 7: 28, 8: 32, 9: 40,
  },
  weight: { 4: '400', 5: '500', 6: '600', 7: '700' },
  letterSpacing: {},
  face: {
    400: { normal: 'Inter_400Regular' },
    500: { normal: 'Inter_500Medium' },
    600: { normal: 'Inter_600SemiBold' },
    700: { normal: 'Inter_700Bold' },
  },
})

// JetBrains Mono — data scale. Use via `fontFamily="$mono"` on Tamagui
// Text components, or spread TYPE.labelData from theme.ts.
const monoFont = createFont({
  family: 'JetBrainsMono_400Regular',
  size: { 1: 11, 2: 12, 3: 13, 4: 14, 5: 16, 6: 18, 7: 20, 8: 24 },
  lineHeight: { 1: 14, 2: 16, 3: 18, 4: 20, 5: 24, 6: 26, 7: 28, 8: 32 },
  weight: { 4: '400', 5: '500' },
  letterSpacing: {},
  face: {
    400: { normal: 'JetBrainsMono_400Regular' },
    500: { normal: 'JetBrainsMono_500Medium' },
  },
})

const tamaguiConfig = createTamagui({
  ...config,
  fonts: {
    ...config.fonts,
    heading: headingFont,
    body: bodyFont,
    mono: monoFont,
  },
})

export type TamaguiConfig = typeof tamaguiConfig

declare module 'tamagui' {
  // Tell Tamagui's typegen which config powers the design tokens
  interface TamaguiCustomConfig extends TamaguiConfig {}
}

export default tamaguiConfig
