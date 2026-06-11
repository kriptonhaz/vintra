---
"@vintra/web": patch
---

Enforce the attendance billed-staff cap at invite + reactivation time.
Previously the `billedStaffCount` on `attendance_settings` was just a
bookkeeping number — tenants could invite unlimited staff regardless
of what the platform admin set as their paid quota.

Now `inviteStaff` and `setStaffActive(isActive=true)` check the tenant's
active staff count against the billed cap and throw a clear Indonesian
error telling the owner to contact the Vintra team to increase the
quota if they've hit the limit. Deactivating is always allowed; it
frees a slot. Existing staff who were added over the cap before this
fix are grandfathered in (never retroactively deactivated).
