import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/help/feedback')({
  component: FeedbackLayout,
})

function FeedbackLayout() {
  return <Outlet />
}
