/**
 * Attendance flow stack — full-screen routes outside the tabs.
 *   - capture     → modal presentation, camera takes the whole view
 *   - history     → standard stack; uses our ScreenHeader for the
 *                   back button (the native header doesn't reliably
 *                   render the back affordance when we push from a
 *                   Tabs route, so we draw our own)
 *
 * iOS swipe-back gesture explicitly enabled — with headerShown: false
 * the gesture is implicitly disabled unless we opt in.
 */
import { Stack } from 'expo-router'

export default function AttendanceLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen
        name="capture"
        options={{
          presentation: 'modal',
          contentStyle: { backgroundColor: '#000' },
        }}
      />
      <Stack.Screen name="history" />
    </Stack>
  )
}
