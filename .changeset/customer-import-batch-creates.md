---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

`importCustomers` now batches new-customer INSERTs instead of looping one-at-a-time. The previous shape did ~5,000 sequential `INSERT … RETURNING` round-trips for a 5k-row Qasir export, which took ~5 minutes — long enough that Cloudflare's `~100s` idle timeout cut the response with a 524, leaving the client crashing on `data.toCreate` even though the server's transaction had already committed (5,631 rows landed in the DB before the user saw the toast).

Three pieces of the fix:

1. **Batched INSERTs.** CREATEs are now grouped into a single `INSERT … VALUES (…), (…), …` per chunk of 1,000 rows. Five chunks cover a 5k-row import; one round-trip per chunk; total ~2 seconds vs. ~5 minutes. RETURNING preserves insertion order within a single statement, so mapping `inserted[k].id` back to `createIndices[start + k]` is safe even for null-phone rows that can't dedup by phone. UPDATEs stay sequential — they only fire on a re-import (rare, typically small).
2. **Stack-safe dedup.** The in-file phone dedup pass used `parsed.push(...deduped)` which spreads each row as a separate argument and risks blowing V8's argument count limit on large arrays. Replaced with a plain `for` loop.
3. **Defensive UI on commit.** `commitMut.onSuccess` now checks that `data` is a real object before reading `.toCreate` / `.toUpdate`. A truncated response (proxy hiccup, future timeout) shows a generic "Import selesai, refresh halaman untuk verifikasi" success toast instead of an opaque `s is undefined` error.

Postgres caps a single query at 65,535 bound parameters; 5 columns × 1,000 rows per chunk = 5,000 params, leaving plenty of headroom for future schema growth.
