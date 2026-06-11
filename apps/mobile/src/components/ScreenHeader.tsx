/**
 * In-screen page header. Used at the top of each tab + secondary
 * screen so we get a consistent feel without relying on the
 * navigator's chrome (every tab screen sets headerShown: false).
 *
 * Optional `back` slot renders a chevron-left → router.back(); used
 * on pushed sub-routes (history, capture preview) where the nav
 * stack alone doesn't always surface a back affordance.
 */
import { Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import { H1, Paragraph, XStack, YStack } from 'tamagui'
import { ChevronLeft } from '~/lib/icons'
import { COLORS } from '../lib/theme'

interface ScreenHeaderProps {
  title: string
  subtitle?: string
  /** When true, render a chevron-back button on the left that calls router.back(). */
  back?: boolean
  /** Optional right-side action — used for things like a settings button. */
  right?: React.ReactNode
}

export function ScreenHeader({
  title,
  subtitle,
  back,
  right,
}: ScreenHeaderProps) {
  const router = useRouter()

  return (
    <XStack
      ai="center"
      jc="space-between"
      gap="$3"
      px="$5"
      pt="$8"
      pb="$3"
      bg={COLORS.surface}
    >
      {back && (
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: COLORS.surfaceSubtle,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronLeft size={22} color={COLORS.text} />
        </Pressable>
      )}
      <YStack flex={1} gap="$0.5">
        <H1 fontSize="$8" col={COLORS.text} fontWeight="800">
          {title}
        </H1>
        {subtitle ? (
          <Paragraph fontSize="$3" col={COLORS.textMuted}>
            {subtitle}
          </Paragraph>
        ) : null}
      </YStack>
      {right}
    </XStack>
  )
}
