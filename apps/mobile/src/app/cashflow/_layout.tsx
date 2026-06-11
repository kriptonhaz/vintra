import { Stack } from 'expo-router'

export default function CashflowLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    />
  )
}
