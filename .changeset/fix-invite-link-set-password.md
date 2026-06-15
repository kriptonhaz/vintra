---
"@vintra/web": patch
---

Fix invited members unable to set their password. Invite links arrive as an implicit-flow hash with type=invite, but the set-password page only consumed the hash when type=recovery — so invite tokens were ignored, the page fell back to a stale session, and submitting either failed or updated the wrong account (the invited user's password was never set, so login failed). The page now establishes the session from the hash tokens regardless of type (recovery/invite/signup), so accepting an invite and setting a first password works and redirects to login.
