/**
 * Brand-green hero band used at the top of every auth screen. Two
 * variants:
 *
 *   - horizontal (default): logo on the left, text right; headline +
 *     subhead stacked below. Used by forgot-password, register.
 *   - centered: logo on top, text below, all vertically centered. No
 *     headline. Used by the main login screen since the form itself
 *     carries the welcome copy.
 */
import { Image } from 'react-native'
import { H1, Paragraph, XStack, YStack } from 'tamagui'
import { COLORS, FONTS } from '../lib/theme'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const logo = require('../../assets/icon.png')

const BRAND = COLORS.primary

interface BrandHeroProps {
  variant?: 'horizontal' | 'centered'
  headline?: string
  subhead?: string
}

export function BrandHero({
  variant = 'horizontal',
  headline,
  subhead,
}: BrandHeroProps) {
  if (variant === 'centered') {
    // Logo only. Extra bottom padding gives the next-down content
    // room to overlap with a negative margin (modern "card pops out
    // of the header" pattern).
    return (
      <YStack bg={BRAND} pt="$10" pb="$10" px="$6" ai="center">
        <YStack
          w={72}
          h={72}
          br={16}
          ai="center"
          jc="center"
          overflow="hidden"
          bg="white"
        >
          <Image
            source={logo}
            style={{ width: 84, height: 84 }}
            resizeMode="cover"
          />
        </YStack>
      </YStack>
    )
  }

  return (
    <YStack bg={BRAND} pt="$10" pb="$8" px="$6" gap="$5">
      <XStack ai="center" gap="$3">
        <YStack
          w={48}
          h={48}
          br={12}
          ai="center"
          jc="center"
          overflow="hidden"
          bg="white"
        >
          <Image
            source={logo}
            style={{ width: 56, height: 56 }}
            resizeMode="cover"
          />
        </YStack>
        <YStack gap="$1">
          <Paragraph
            color="white"
            fontFamily={FONTS.headingBold}
            fontSize={18}
            lineHeight={24}
          >
            Vintra
          </Paragraph>
          <Paragraph
            color="white"
            fontFamily={FONTS.body}
            fontSize={12}
            lineHeight={16}
            opacity={0.85}
          >
            Kelola usaha dari mana saja
          </Paragraph>
        </YStack>
      </XStack>
      {(headline || subhead) && (
        <YStack gap="$1.5">
          {headline && (
            <H1 fontFamily={FONTS.headingBold} fontSize={24} lineHeight={32} color="white">
              {headline}
            </H1>
          )}
          {subhead && (
            <Paragraph
              color="white"
              fontFamily={FONTS.body}
              fontSize={14}
              lineHeight={20}
              opacity={0.9}
              maxWidth={300}
            >
              {subhead}
            </Paragraph>
          )}
        </YStack>
      )}
    </YStack>
  )
}
