import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Branches lifted to a top-level Data Master entry. This route stays
 * as a redirect so existing bookmarks / in-app links keep working
 * while we transition. Safe to delete in a few releases.
 */
export const Route = createFileRoute('/_authed/inventory/branches')({
  beforeLoad: () => {
    throw redirect({ to: '/master/branches' })
  },
})
