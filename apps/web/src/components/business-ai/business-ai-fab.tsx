import { useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useCurrentUser } from '@/hooks/use-permissions'
import logoWhite from '@/assets/images/logo-white.png'
import { BusinessAiPanel, type AiChatMsg } from './business-ai-panel'

/**
 * Vintra AI floating action button (Komplit tier). Rendered on every
 * authed route via `_authed.tsx`; renders nothing unless BOTH gates
 * pass — the tenant tier carries `business_ai` AND this member has the
 * owner-granted `businessAiEnabled` flag (owners always do).
 *
 * Chat state lives here (not in the panel) so the conversation survives
 * open/close but intentionally clears on page reload — no persistence.
 *
 * z-40 keeps the button under the mobile sidebar overlay (z-40/50);
 * the opened panel uses z-50 like other modal surfaces.
 */
export function BusinessAiFab() {
  const { data: user } = useCurrentUser()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<AiChatMsg[]>([])

  const hasAccess =
    (user?.moduleSubscriptions?.pos?.features ?? []).includes('business_ai') &&
    user?.businessAiEnabled === true

  // The cashier screen is a dense full-width flow — the FAB would sit
  // on top of the cart totals. Same suppression as AppLayout's
  // COMPACT_ROUTES.
  const suppressed = location.pathname.startsWith('/pos/cashier')

  if (!hasAccess || suppressed) return null

  return (
    <>
      {open && (
        <BusinessAiPanel
          messages={messages}
          setMessages={setMessages}
          onClose={() => setOpen(false)}
        />
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Tutup Vintra AI' : 'Buka Vintra AI'}
        className="fixed right-4 bottom-4 z-40 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-gray-900 shadow-lg shadow-gray-900/30 ring-1 ring-white/10 transition-all hover:scale-105 dark:bg-black"
      >
        {open ? (
          <span className="flex h-full w-full items-center justify-center bg-gray-900 text-white dark:bg-black">
            <X className="h-6 w-6" />
          </span>
        ) : (
          <img src={logoWhite} alt="Vintra AI" className="h-7 w-7" />
        )}
      </button>
    </>
  )
}
