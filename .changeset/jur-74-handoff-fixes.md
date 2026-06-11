---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-74 follow-ups from review:

- Pengaturan AI now has a single "Simpan Pengaturan" button at the
  bottom of the form (was duplicated — one per card). Both AI config
  and Handoff fields persist together in a single PATCH.
- Conversation header gains a per-contact "Jeda AI" / "Aktifkan AI"
  toggle, always visible. Lets admin pause auto-reply for a specific
  contact even when AI itself didn't trigger handoff (e.g., during
  a manual negotiation). Mirrors the banner button when in handoff.
- Heuristic handoff detector switched from substring to regex with
  filler tolerance. Production case "aku alihkan **chat ini** ke
  admin" was missed by the substring matcher and never fired the
  notification. Regex now also catches "nanti admin yang akan",
  "admin yang bantu", "diteruskan ke admin", and "hubungin admin".
- 5 new positive test cases covering the missed phrasings.
