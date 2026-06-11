/**
 * Inventory stack — full-screen routes for item details + requisition
 * flows that live outside the bottom-tabs context. We rely on each
 * screen's own ScreenHeader (with a back chevron) for the back
 * affordance — the native stack header doesn't render reliably when
 * the screen is pushed from a Tabs route.
 *
 * iOS swipe-back gesture explicitly enabled — with headerShown: false
 * the gesture is implicitly disabled unless we opt in.
 */
import { Stack } from 'expo-router'

export default function InventoryLayout() {
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
