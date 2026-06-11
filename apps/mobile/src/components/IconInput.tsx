/**
 * Text input with a leading icon (and optional trailing slot for things
 * like the password eye toggle). Reused across auth screens so the
 * visual treatment stays consistent.
 *
 * Tall pill style by default (h=56, br=full) to match the Asana-style
 * reference design — gives forms a modern, friendly silhouette and good
 * thumb-target sizing. Layout uses an XStack-as-container pattern with
 * the icon as a flex sibling (NOT absolute-positioned) — the absolute
 * approach previously fought Tamagui's Input internal padding and let
 * the icon overlap placeholder text on iOS.
 */
import { forwardRef, type ReactNode } from 'react'
import { TextInput, type TextInputProps } from 'react-native'
import { XStack } from 'tamagui'
import { COLORS, FONTS } from '../lib/theme'

interface IconInputProps extends Omit<TextInputProps, 'style'> {
  /** Leading icon, typically from ~/lib/icons. */
  leading: ReactNode
  /** Optional trailing slot (e.g., password show/hide button). */
  trailing?: ReactNode
}

export const IconInput = forwardRef<TextInput, IconInputProps>(function IconInput(
  { leading, trailing, ...textInputProps },
  ref,
) {
  return (
    <XStack
      ai="center"
      bg={COLORS.surfaceContainerLow}
      br={9999}
      px="$4"
      gap="$3"
      h={56}
      borderWidth={1}
      borderColor={COLORS.outlineVariant}
    >
      {leading}
      <TextInput
        ref={ref}
        style={{
          flex: 1,
          fontSize: 15,
          fontFamily: FONTS.body,
          color: COLORS.onSurface,
          paddingVertical: 0, // RN's Android TextInput adds 8px by default; kill it
        }}
        placeholderTextColor={COLORS.outline}
        {...textInputProps}
      />
      {trailing}
    </XStack>
  )
})
