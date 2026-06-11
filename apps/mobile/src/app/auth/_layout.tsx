/**
 * Auth stack — login, forgot-password, register-stub. No header
 * (each screen has its own brand-green hero band), but we keep
 * iOS swipe-back enabled so users can return to login from any
 * sub-screen with the natural edge-swipe gesture.
 *
 * `gestureEnabled: true` + `fullScreenGestureEnabled: true` together
 * mean the swipe works from ANYWHERE on the screen (not just the
 * thin left edge), which is the modern iOS expectation since iOS 13.
 */
import { Stack } from 'expo-router'

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
        contentStyle: { backgroundColor: '#F1F5F9' },
      }}
    />
  )
}
