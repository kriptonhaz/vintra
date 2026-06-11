---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-80 (frontend half): render the captured reactions on bubbles.

- API: `GET /v1/wa/instances/:id/messages` now fan-out fetches
  reactions via `ListReactionsForMessages($1::uuid[])` (one round
  trip, not N) and pivots them into a `reactions` field on each
  message response.
- Web: bubble component renders a small pill row just below the
  bubble, on the same side as the bubble. Identical emojis are
  grouped with a count so 3 senders all reacting 👍 takes one
  pill-width, not three. Negative top margin pulls the pill
  to overlap the bubble's bottom edge — matches WhatsApp's
  native UI.
- Sticker bubbles get reactions too (the sticker branch was a
  separate render path).

Pairs with the backend half — once both are deployed, the UI
shows reactions in real time as the worker upserts them. Empty
reactions array means the omitempty side of the API response
omits the field entirely; the UI handles `undefined` cleanly.
