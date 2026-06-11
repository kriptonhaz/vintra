---
"@vintra/web": patch
---

Fix blank sidebar on fresh page loads by priming the `['current-user']` React Query cache with the route loader's already-resolved user. Previously the sidebar's `useCurrentUser()` started pending → empty permissions → every `hasPerm()` returned false → no nav items rendered until the client-side refetch completed.
