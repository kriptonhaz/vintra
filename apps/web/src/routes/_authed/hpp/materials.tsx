import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/hpp/materials')({
  beforeLoad: () => {
    throw redirect({ to: '/master/suppliers' })
  },
  component: () => null,
})
