---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Referral program upgrades:

- Optional per-code max-claims cap. Owners can set a usage limit (e.g.
  1000); once reached, the public validator returns quota-exhausted
  and the register form shows "kuota penuh" instead of "valid". The
  attribution writer uses an atomic INSERT … WHERE … COUNT(*) <
  max_claims so concurrent signups can't push past the cap.
- Share dialog on the /referrals page. Each code now has a Share
  button that opens a dialog with the full share URL
  (`<origin>/?ref=CODE`), one-click copy, deep links to WhatsApp /
  Telegram / Facebook with a pre-filled Indonesian message, and the
  native Web Share sheet on mobile.
