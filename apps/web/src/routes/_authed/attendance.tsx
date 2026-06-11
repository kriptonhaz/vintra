import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

const MODULE_KEY = 'attendance'

export const Route = createFileRoute('/_authed/attendance')({
  beforeLoad: ({ context, location }) => {
    const user = (context as {
      user?: {
        tenant?: { activeModules?: string[] }
        moduleSubscriptions?: {
          attendance?: {
            active: boolean
            isExpired: boolean
            trialActive: boolean
          }
        }
      }
    }).user
    const activeModules = user?.tenant?.activeModules ?? []
    const hasModule = activeModules.includes(MODULE_KEY)
    const sub = user?.moduleSubscriptions?.attendance
    // Live access requires: module listed AND (paid subscription active
    // AND not expired OR trial currently running). Matches the server
    // middleware. This just bounces the user to /locked before they hit
    // a broken loader.
    const paidOk = sub ? sub.active && !sub.isExpired : false
    const trialOk = sub?.trialActive ?? false
    const isActive = hasModule && (paidOk || trialOk)
    const isLockedPage = location.pathname === '/attendance/locked'

    if (!isActive && !isLockedPage) {
      throw redirect({ to: '/attendance/locked' })
    }
    if (isActive && isLockedPage) {
      throw redirect({ to: '/attendance' })
    }
  },
  component: () => <Outlet />,
})
