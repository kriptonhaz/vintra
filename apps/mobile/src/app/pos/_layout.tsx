/**
 * POS checkout + success routes — separate stack from the tabs so
 * the bottom tab bar hides while the user is mid-checkout. Header is
 * standard.
 */
import { Stack } from 'expo-router'

export default function PosLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#FFFFFF' },
        headerTintColor: '#0F172A',
        headerTitleStyle: { fontWeight: '600' },
      }}
    />
  )
}
