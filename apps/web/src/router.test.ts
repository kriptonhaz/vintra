import { describe, expect, it } from 'bun:test'
import { createRouter } from './router'

/**
 * TanStack installs a catch boundary around a route ONLY when an error
 * component is configured — `Match.js` resolves it to a plain fragment
 * otherwise. So the presence of `defaultErrorComponent` is not cosmetic:
 * it is the difference between a render error showing a message and a
 * render error unmounting the entire app to a white screen, with only
 * React's teardown failure ("Failed to execute 'removeChild'") in the
 * console to explain it.
 *
 * That is exactly the state this app shipped in, and nothing failed
 * loudly enough to notice. Hence a test on the wiring itself.
 */
describe('router error handling', () => {
  it('configures an error component, so routes get a catch boundary', () => {
    expect(createRouter().options.defaultErrorComponent).toBeDefined()
  })

  it('configures onCatch, so the real error still reaches the console', () => {
    // The boundary shows the message; the log preserves the whole error
    // for whoever reads the support report.
    expect(createRouter().options.defaultOnCatch).toBeDefined()
  })
})
