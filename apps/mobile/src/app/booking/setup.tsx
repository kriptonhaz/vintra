/**
 * Setup is a legacy redirect on web. Mobile mirrors that — push to
 * settings on mount so existing notification deep-links still work.
 */
import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator } from 'react-native'
import { YStack } from 'tamagui'
import { COLORS } from '~/lib/theme'

export default function BookingSetupRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/booking/settings' as never)
  }, [router])
  return (
    <YStack flex={1} bg={COLORS.background} ai="center" jc="center">
      <ActivityIndicator color={COLORS.primary} />
    </YStack>
  )
}
