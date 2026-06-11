import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/booking')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    const perms = user?.permissions ?? []
    if (!perms.includes('booking.read')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: () => <Outlet />,
})
