import { createFileRoute, redirect } from '@tanstack/react-router'

// The Logo standalone gallery has been merged into the combined
// Konten & Branding gallery at /studio. Existing bookmarks redirect.
export const Route = createFileRoute('/_authed/logo/')({
  beforeLoad: () => {
    throw redirect({ to: '/studio' })
  },
})
