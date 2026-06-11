/**
 * HPP stack — dashboard list + recipe wizard. Pushed from the Lainnya
 * tab. Each screen owns its own ScreenHeader so the native stack header
 * stays hidden (matches the inventory + attendance stacks).
 */
import { Stack } from 'expo-router'

export default function HppLayout() {
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
