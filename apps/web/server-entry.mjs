// Production Node entry. PM2 runs this directly.
// In prod, nginx fronts this and serves /assets/* and /_build/* directly
// from `dist/client/` (faster + offloads bandwidth from Node).
import { serve } from '@hono/node-server'
import handler from './dist/server/server.js'

const port = Number(process.env.PORT) || 3000

const server = serve(
  {
    fetch: handler.fetch,
    port,
    hostname: '0.0.0.0',
  },
  (info) => {
    console.log(`Vintra listening on http://${info.address}:${info.port}`)
  },
)

// Graceful shutdown. On a deploy, PM2 sends SIGINT to restart this
// instance. Without a handler, Node terminates immediately and any
// in-flight request is severed mid-response — nginx then hands an
// empty/partial reply back to Cloudflare, which surfaces as a 520.
//
// Instead: stop accepting new connections (nginx fails over to the
// other instance), drop idle keep-alive sockets so close() only waits
// on requests actually in progress, let those finish, then exit. The
// unref'd timer is a safety net for a stuck connection so a deploy
// can never hang on drain.
let shuttingDown = false
function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[shutdown] ${signal} received — draining connections`)
  server.close(() => {
    console.log('[shutdown] connections drained — exiting')
    process.exit(0)
  })
  server.closeIdleConnections()
  setTimeout(() => {
    console.log('[shutdown] drain timed out — forcing exit')
    process.exit(0)
  }, 8000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
