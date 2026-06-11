/**
 * JUR-184: the template-picker setup wizard was replaced with the
 * unified /booking/settings page. This route now just redirects so
 * old sidebar links / bookmarks still land somewhere useful.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/booking/setup')({
  beforeLoad: () => {
    throw redirect({ to: '/booking/settings' })
  },
})
