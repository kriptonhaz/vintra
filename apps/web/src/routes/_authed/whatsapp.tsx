import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

/**
 * Layout for all /whatsapp/* routes. Mirrors the `_authed/attendance.tsx`
 * gate pattern — checks the user's permissions once before any nested
 * loader runs, so unauthorized callers (e.g. staff/cashier roles) bounce
 * to /dashboard instead of seeing a half-rendered page whose useQuery
 * calls silently fall back to empty arrays.
 *
 * Also forwards a `wa.canManage` flag through the router context so
 * child routes can hide write affordances ("Tambah WhatsApp", trash
 * icons, settings forms) for read-only viewers (supervisor role).
 */
export const Route = createFileRoute('/_authed/whatsapp')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    const perms = user?.permissions ?? []
    if (!perms.includes('whatsapp.read')) {
      throw redirect({ to: '/dashboard' })
    }
    return {
      wa: {
        canManage: perms.includes('whatsapp.manage'),
      },
    }
  },
  component: () => <Outlet />,
})
