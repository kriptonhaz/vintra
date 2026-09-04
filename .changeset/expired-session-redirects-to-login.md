---
"@vintra/web": patch
---

Send an expired session to the login page instead of an error screen.

`requireAuth` threw `new Error('Unauthorized')` whenever it could not establish a
session. Route loaders call server functions that run it, so a merely *expired*
session rendered the router's error boundary — a page that tells the user
something broke — rather than asking them to sign in again. `refreshSessionCoalesced`
makes losing the refresh-token rotation race rarer than it would otherwise be, but
not impossible, and every loss took a working account to a screen that looked like
a fault.

Web now gets `redirect({ to: '/auth/login' })`. The server-fn transport runs
`parseRedirect()` over a thrown error and rethrows it, so this reaches the router
as a real navigation.

The mobile RPC bridge keeps the `Error`. `routes/api.mobile.$fn.ts` infers its HTTP
status by string-matching `err.message`, and "unauthorized" is what makes it answer
401 — the signal the app's re-login flow waits for. A redirect object has no
`.message` and would surface as a 500. That bridge is the only API route using
`requireAuth`, so a path-prefix guard covers it exactly.

This removes the symptom, not the race: the rotation still loses just as often, but
the user is asked to log in rather than shown a broken page.
