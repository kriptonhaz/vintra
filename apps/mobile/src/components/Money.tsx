/**
 * Money / Stat — typography helpers for numeric data.
 *
 * Per the design system (design.md → Typography → Data role):
 *   "JetBrains Mono. Used specifically for currency (Rupiah), stock
 *   counts, and time stamps. This monospaced font ensures that columns
 *   of numbers align perfectly in HPP tables and digital receipts."
 *
 * Use `<Money amount={..} />` for IDR. Use `<Stat>...</Stat>` for any
 * other numeric (stock counts, percentages, time strings) where column
 * alignment matters.
 *
 * Both render through Tamagui's Paragraph so they pick up theming and
 * still accept all standard Paragraph props (col, fontSize, etc).
 */
import { Paragraph, type ParagraphProps } from 'tamagui'
import { FONTS, COLORS } from '../lib/theme'
import { formatRupiah } from '../lib/currency'

export interface MoneyProps extends Omit<ParagraphProps, 'children'> {
  amount: number
  /** Use the bolder monospace face for headline currency. */
  emphasis?: boolean
}

export function Money({ amount, emphasis = false, ...rest }: MoneyProps) {
  return (
    <Paragraph
      fontFamily={emphasis ? FONTS.monoMedium : FONTS.mono}
      color={COLORS.onSurface}
      {...rest}
    >
      {formatRupiah(amount)}
    </Paragraph>
  )
}

export interface StatProps extends ParagraphProps {
  /** Use the bolder monospace face. */
  emphasis?: boolean
}

export function Stat({ emphasis = false, children, ...rest }: StatProps) {
  return (
    <Paragraph
      fontFamily={emphasis ? FONTS.monoMedium : FONTS.mono}
      color={COLORS.onSurface}
      {...rest}
    >
      {children}
    </Paragraph>
  )
}
