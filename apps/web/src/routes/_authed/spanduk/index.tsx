import { createFileRoute, redirect } from '@tanstack/react-router'

// Spanduk shares the combined gallery at /studio.
export const Route = createFileRoute('/_authed/spanduk/')({
  beforeLoad: () => {
    throw redirect({ to: '/studio' })
  },
})
