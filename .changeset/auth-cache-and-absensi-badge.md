---
"@vintra/web": patch
---

Two tenant-session fixes:

- Clear react-query cache when the auth user changes so cached per-user
  data (notably the `platform-admin-status` flag) doesn't leak from one
  session into the next. `QueryClientProvider` now wraps `AuthProvider`
  so the auth hook can call `queryClient.clear()` on sign-in / sign-out
  and when the Supabase `onAuthStateChange` subscription reports a
  different user id.
- Absensi card on the dashboard now reflects real subscription state:
  shows green "Aktif" when the tenant has `attendance` in
  `activeModules`, otherwise amber "Pro" (both clickable — the
  unsubscribed state lands on `/attendance/locked`). Removed the
  outdated "Segera Hadir" / locked treatment.
