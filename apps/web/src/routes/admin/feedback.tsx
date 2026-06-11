import { createFileRoute, Outlet } from '@tanstack/react-router'

// Layout shell so `/admin/feedback` (index) and `/admin/feedback/$threadId`
// (detail) can coexist. Without this, navigating to the detail leaves
// the list rendered because the parent's component swallows the route.
export const Route = createFileRoute('/admin/feedback')({
  component: AdminFeedbackLayout,
})

function AdminFeedbackLayout() {
  return <Outlet />
}
