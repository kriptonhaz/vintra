import { createFileRoute, redirect } from '@tanstack/react-router'

// The Konten standalone gallery has been merged into the combined
// Konten & Branding gallery at /studio. Existing bookmarks redirect.
export const Route = createFileRoute('/_authed/konten/')({
  beforeLoad: () => {
    throw redirect({ to: '/studio' })
  },
})
