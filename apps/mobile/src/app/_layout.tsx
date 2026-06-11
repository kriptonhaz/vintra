/**
 * Root layout — wraps every screen with the providers everyone needs:
 *   - TamaguiProvider (design tokens + theme)
 *   - QueryClientProvider (server-fn fetching)
 *   - AuthProvider (Supabase session)
 *   - TenantProvider (active tenant context)
 *
 * Plus the routing guards: signed-out users land on /auth/login, and
 * signed-in users with a multi-tenant ambiguity land on /tenant-picker
 * before they see the tabs.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { TamaguiProvider, YStack, Spinner } from 'tamagui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useColorScheme } from 'react-native'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
import {
  Manrope_600SemiBold,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope'
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter'
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono'

import tamaguiConfig from '../../tamagui.config'
import { AuthProvider, useAuth } from '../lib/auth-context'
import { TenantProvider, useTenant } from '../lib/tenant-context'
import { OutletProvider } from '../lib/outlet-context'
import { CartProvider } from '../lib/cart-context'
import { COLORS } from '../lib/theme'

SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5 * 60 * 1000, retry: 1 },
        },
      }),
  )

  // Load the three font families used by the design system. The keys
  // MUST match the family-name strings in src/lib/theme.ts FONTS — that's
  // how RN's font table resolves `fontFamily: "Manrope_700Bold"` at render
  // time. expo-font cleverly returns true while still loading so we can
  // gate the splash on this; if loading fails we render anyway with a
  // system fallback rather than blocking the user.
  const [fontsLoaded, fontError] = useFonts({
    Manrope_600SemiBold,
    Manrope_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  })

  const fontsReady = fontsLoaded || !!fontError

  // Provider order matters: TamaguiProvider hosts the portal that
  // `Sheet modal` teleports its content into, so it must sit INSIDE the
  // React-context providers (Query/Auth/Tenant/Cart). Otherwise hooks
  // used inside a modal sheet (useTenant, useQueryClient, useCart) lose
  // their provider — "useTenant must be used inside <TenantProvider>".
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <TenantProvider>
            <OutletProvider>
              <CartProvider>
                <TamaguiProvider
                  config={tamaguiConfig}
                  defaultTheme={colorScheme === 'dark' ? 'dark' : 'light'}
                >
                  <StatusBar style="auto" />
                  <RouteGuard fontsReady={fontsReady}>
                    <Slot />
                  </RouteGuard>
                </TamaguiProvider>
              </CartProvider>
            </OutletProvider>
          </TenantProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  )
}

/**
 * Routing gate — runs on every navigation event and shoves the user
 * to the right stack based on (auth state, tenant state, current segment).
 *
 * Decision tree:
 *
 *   not signed in              → /auth/login
 *   signed in, tenants loading → render the splash (don't bounce mid-resolve)
 *   signed in, no tenants      → sign out (degenerate case; v1 shouldn't hit)
 *   signed in, needs picker    → /tenant-picker
 *   signed in, ready, in auth  → /  (kick out of auth stack)
 *   signed in, ready, picker   → /  (kick out of picker once chosen)
 *   else                       → no redirect, render the current route
 */
function RouteGuard({
  children,
  fontsReady,
}: {
  children: ReactNode
  fontsReady: boolean
}) {
  const { loading: authLoading, session, signOut } = useAuth()
  const { state: tenantState } = useTenant()
  const router = useRouter()
  const segments = useSegments()
  const [splashHidden, setSplashHidden] = useState(false)

  const inAuth = segments[0] === 'auth'
  const inPicker = segments[0] === 'tenant-picker'

  useEffect(() => {
    if (authLoading) return

    if (!session) {
      if (!inAuth) router.replace('/auth/login')
      return
    }

    if (tenantState.status === 'loading') return

    if (tenantState.status === 'no-tenants') {
      void signOut()
      return
    }

    if (tenantState.status === 'needs-picker') {
      if (!inPicker) router.replace('/tenant-picker')
      return
    }

    // status === 'ready'
    if (inAuth || inPicker) router.replace('/')
  }, [
    authLoading,
    session,
    tenantState.status,
    inAuth,
    inPicker,
    router,
    signOut,
  ])

  // Hide the native splash once fonts are loaded AND we've decided where
  // to go (or immediately when sign-in is required — the auth screens are
  // visually OK to show alone). Showing the auth screen with system fonts
  // before Manrope/Mono register would cause a jarring re-flow.
  useEffect(() => {
    if (splashHidden) return
    if (!authLoading && fontsReady) {
      SplashScreen.hideAsync().catch(() => {})
      setSplashHidden(true)
    }
  }, [authLoading, fontsReady, splashHidden])

  // While auth, tenant, or fonts are still resolving, render a centered
  // spinner so the user doesn't see a white flash or a font swap.
  const stillResolving =
    !fontsReady ||
    authLoading ||
    (session && tenantState.status === 'loading') ||
    (session && tenantState.status === 'needs-picker' && !inPicker)

  if (stillResolving) {
    return (
      <YStack flex={1} ai="center" jc="center" backgroundColor={COLORS.background}>
        <Spinner size="large" color={COLORS.primary} />
      </YStack>
    )
  }

  return <>{children}</>
}
