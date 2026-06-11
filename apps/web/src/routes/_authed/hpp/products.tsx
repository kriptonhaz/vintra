/**
 * `/hpp/products` is retired. The product list now lives on `/hpp`
 * (dashboard table) and the product detail modal there carries every
 * action that was on this page — Edit (deeplinks to the wizard),
 * Jual di POS (bridges to inventory), and the inline recipe view in
 * the modal's Cost Breakdown section.
 *
 * Kept as a redirect rather than deleted outright so any bookmark or
 * external link to /hpp/products lands the cashier on the new home
 * instead of a 404.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authed/hpp/products')({
  beforeLoad: () => {
    throw redirect({ to: '/hpp' })
  },
  component: () => null,
})
