/**
 * Bottom tab navigation — 5 tabs:
 *   1. Beranda    (home — greeting + role-aware widgets)
 *   2. Kasir      (POS — renamed from "POS" to match how owners talk)
 *   3. Inventory  (stock; placeholder in this iteration, full CRUD coming)
 *   4. Absensi    (attendance)
 *   5. Lainnya    (tenant switcher, profile, logout, etc.)
 *
 * Each tab screen owns its own visual header (matches the brand-green
 * hero pattern from auth) so the navigator's default header is hidden
 * — otherwise every screen would have a double-header.
 *
 * Brand-green active tint mirrors the web's --color-brand-500.
 */
import { Tabs } from 'expo-router'
import {
  Calendar,
  Home,
  MoreHorizontal,
  Package,
  ShoppingCart,
} from '~/lib/icons'
import { COLORS } from '../../lib/theme'

const ACTIVE = COLORS.primary
const INACTIVE = COLORS.outline

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: COLORS.outlineVariant,
          borderTopWidth: 1,
          height: 84,
          paddingTop: 6,
          paddingBottom: 24,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Beranda',
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="pos"
        options={{
          title: 'Kasir',
          tabBarIcon: ({ color, size }) => (
            <ShoppingCart color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: 'Inventory',
          tabBarIcon: ({ color, size }) => (
            <Package color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="absensi"
        options={{
          title: 'Absensi',
          tabBarIcon: ({ color, size }) => (
            <Calendar color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="lainnya"
        options={{
          title: 'Lainnya',
          tabBarIcon: ({ color, size }) => (
            <MoreHorizontal color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  )
}
