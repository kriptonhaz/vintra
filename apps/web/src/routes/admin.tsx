import { useState, useCallback } from 'react'
import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import { getCurrentUser } from '@/server/functions/auth'
import { getPlatformAdminStatus } from '@/server/functions/admin'
import { AdminSidebar } from '@/components/layout/admin-sidebar'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { LanguageSwitcher } from '@/components/layout/language-switcher'
import { NotificationBell } from '@/components/notifications/bell'
import { useAuth } from '@/hooks/use-auth'

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const user = await getCurrentUser()
    if (!user) {
      throw redirect({ to: '/auth/login' })
    }
    const status = await getPlatformAdminStatus()
    if (!status.isPlatformAdmin) {
      throw redirect({ to: '/dashboard' })
    }
    return { user }
  },
  component: AdminLayout,
})

function AdminLayout() {
  const { user } = Route.useRouteContext()
  const { signOut } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  async function handleLogout() {
    await signOut()
    navigate({ to: '/auth/login' })
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AdminSidebar
        isOpen={sidebarOpen}
        onClose={closeSidebar}
        onLogout={handleLogout}
        user={{ name: user.fullName ?? t('admin.brandTitle'), email: user.email }}
      />

      <div className="overflow-x-hidden lg:pl-64">
        <header className="fixed top-0 right-0 left-0 z-20 flex h-16 items-center gap-2 border-b border-gray-200 bg-white px-4 dark:border-gray-700 dark:bg-gray-800 sm:gap-4 sm:px-6 lg:left-64">
          <button
            type="button"
            onClick={toggleSidebar}
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 lg:hidden"
            aria-label={t('layout.openMenu')}
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
            {t('admin.modeBadge')}
          </span>
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-1">
            <LanguageSwitcher />
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>

        <main className="px-4 pt-22 pb-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
