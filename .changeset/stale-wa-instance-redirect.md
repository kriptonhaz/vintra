---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix: /whatsapp/$id silently rendered NotPairedGate when the instance UUID in
the URL didn't exist (stale link, copy-paste typo, or instance deleted),
making the URL look valid. The route now probes `getWaInstance` in
`beforeLoad` and redirects to /whatsapp if it 404s, so the user lands on
the instance list instead of an unhelpful pairing screen.
