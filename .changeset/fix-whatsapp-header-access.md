---
"@vintra/web": patch
---

Fix the two `tsc` errors in the WhatsApp server functions, restoring a clean
typecheck for `@vintra/web`.

`apiFetch` read the request headers defensively —
`headers.get?.('authorization') ?? headers['authorization'] ?? ''` — covering
both a `Headers` instance and a plain object. `getRequestHeaders()` returns the
H3 event's `req.headers`, which is always a real `Headers` instance, so
`.get?.()` could never short-circuit and the bracket-index fallback was
unreachable. It was also the only thing failing the typecheck, since
`TypedHeaders<RequestHeaderMap>` declares no index signature (TS7053).

Now reads `headers.get('authorization') ?? ''`, matching TanStack's own
`getRequestHeader`. No runtime behaviour change — `.get()` already returned
`null` for a missing header and `?? ''` handles it the same way.
