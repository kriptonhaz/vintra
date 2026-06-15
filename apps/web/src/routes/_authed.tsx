import { createFileRoute, Outlet, redirect, useLocation, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { getCurrentUser } from '@/server/functions/auth'
import { AppLayout } from '@/components/layout/app-layout'
import { ImpersonationBanner } from '@/components/layout/impersonation-banner'
import { BranchProvider } from '@/hooks/use-branch'
import { useAuth } from '@/hooks/use-auth'
import { useInventoryRealtime } from '@/hooks/use-inventory-realtime'
import { ROUTE_TITLE_KEYS } from '@/lib/constants'

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const user = await getCurrentUser()
    if (!user) {
      throw redirect({ to: '/auth/login' })
    }
    // Redirect to onboarding if no tenant or onboarding not completed
    if (
      (!user.tenant || !user.tenant.onboardingCompleted) &&
      location.pathname !== '/onboarding'
    ) {
      throw redirect({ to: '/onboarding' })
    }
    return { user }
  },
  component: AuthedLayout,
})

function AuthedLayout() {
  const { user } = Route.useRouteContext()
  const { signOut } = useAuth()
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Stream live inventory changes to this tab for the whole session, so stock
  // edited on another device shows up here without a manual refresh.
  useInventoryRealtime(user.tenant?.id)

  // Prime the ['current-user'] query cache with the loader-resolved user.
  // Without this, the sidebar's `useCurrentUser()` hook starts in pending
  // state on every fresh page load — its `permissions` array is empty
  // until the client-side fetch completes, and `hasPerm()` returns false
  // for everything, so the entire nav renders blank for a brief flash.
  // Setting the cache synchronously means the very first render already
  // has permissions resolved.
  queryClient.setQueryData(['current-user'], user)

  // Onboarding page renders without the app layout
  if (location.pathname === '/onboarding') {
    return <Outlet />
  }

  async function handleLogout() {
    await signOut()
    navigate({ to: '/auth/login' })
  }

  // Derive the title from the current pathname
  const pathname = location.pathname
  const titleKey =
    ROUTE_TITLE_KEYS[pathname] ??
    // Try prefix match for nested routes (e.g. /hpp/materials → /hpp)
    Object.entries(ROUTE_TITLE_KEYS).find(([route]) =>
      route !== '/' && pathname.startsWith(route + '/'),
    )?.[1] ??
    'route.dashboard'

  return (
    <BranchProvider>
      {user.impersonating && user.impersonatedTenantName && (
        <ImpersonationBanner tenantName={user.impersonatedTenantName} />
      )}
      <div className={user.impersonating ? 'pt-9' : undefined}>
        <AppLayout
          title={t(titleKey)}
          user={{
            name: user.fullName ?? 'Pengguna',
            businessName: user.tenant?.businessName ?? '',
          }}
          onLogout={handleLogout}
        >
          <Outlet />
        </AppLayout>
      </div>
    </BranchProvider>
  )
}
