import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { RouteError } from './components/layout/route-error'

export function createRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    /**
     * Installs the catch boundary. TanStack only wraps a route in one
     * when an error component exists — `Match.js` falls back to a plain
     * fragment otherwise — so without this line a render error escapes
     * to the React root and takes the whole app down, leaving a white
     * screen whose only console output is React's teardown failure
     * ("Failed to execute 'removeChild'"). That message describes the
     * collapse, not its cause, which made such bugs near-undiagnosable
     * from a user's screenshot.
     */
    defaultErrorComponent: RouteError,
    /**
     * Log the real error before the boundary renders. The screen shows
     * the message; this puts the full object in the console for anyone
     * reading a support report.
     */
    defaultOnCatch: (error, errorInfo) => {
      console.error('[vintra] route error', error, errorInfo)
    },
  })

  return router
}

// TanStack Start expects getRouter to be exported
export async function getRouter() {
  return createRouter()
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createRouter>
  }
}
