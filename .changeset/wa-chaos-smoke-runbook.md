---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Add `docs/wa-chaos-smoke.md` — the production chaos smoke runbook
gating the M4 hardening milestone (JUR-48).

10 scenarios covering:

1. Cold deploy
2. End-to-end AI roundtrip
3. Airplane-mode reconnect
4. WhatsApp logout (no infinite reconnect)
5. SIGTERM mid-send graceful shutdown
6. OOM / memory bounds
7. Redis restart
8. Rate-limit token bucket enforcement (JUR-43 verification)
9. Synthetic panic recovery (JUR-40 verification — needs revert
   before merge)
10. Handoff workflow end-to-end (JUR-74 verification)

Each scenario has a pass/fail criterion + suggested commands. Sign-off
checklist at the end. The actual run requires a deployed staging VPS,
which is human-ops territory — this commit ships the runbook so the
engineer running it has a single source of truth.
