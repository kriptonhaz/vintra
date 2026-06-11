---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix React #418 hydration on /referrals/pendaftar + /referrals/commission (JUR-131):

`formatDate` in `lib/utils.ts` used date-fns `format()` which reads the runtime's local timezone. SSR runs in UTC on the Lightsail box; clients run in Asia/Jakarta (+7). For any timestamp falling between 17:00–24:00 UTC, the two environments render different calendar dates, which fires React #418 on every page rendering server-loaded dates.

JUR-97 was supposed to fix this by migrating away from `toLocaleDateString`, but the date-fns replacement carried the same TZ-naïve bug.

Switched `formatDate` to `date-fns-tz`'s `formatInTimeZone(d, 'Asia/Jakarta', pattern, { locale: id })`. Pins the formatter to WIB so the rendered wall-clock is identical regardless of where the JS runs. Vintra is Indonesia-only, so pinning is semantically correct for every existing caller — no per-call migration needed.

Adds `date-fns-tz@3.2.0` dep.
