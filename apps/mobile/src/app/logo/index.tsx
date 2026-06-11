import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { ActivityIndicator } from 'react-native'
import { YStack } from 'tamagui'
import { COLORS } from '~/lib/theme'

export default function LogoRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/studio' as never)
  }, [router])
  return (
    <YStack flex={1} bg={COLORS.background} ai="center" jc="center">
      <ActivityIndicator color={COLORS.primary} />
    </YStack>
  )
}
