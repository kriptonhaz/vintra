---
"@vintra/web": minor
"@vintra/db": patch
---

Teach the WhatsApp bot about stamp cards.

The RAG dispatcher already had a `loyalty_points` retriever (points balance), but stamp programs were invisible to the bot — a customer asking "berapa stempel saya?" got no useful retrieval, only LLM guesswork. Adds a 10th retrieval type, `loyalty_stamps`, mirroring the `on_customer_match` shape: lookup customer by phone (from `remoteJid`), join `customer_stamp_cards` × `loyalty_stamp_programs` filtered to active programs with non-zero progress, return one snippet listing each card with progress + remaining stamps + reward name. Capped at 5 cards per snippet.

- New Go retriever `loyaltyStampsRetriever` in `apps/api/internal/rag/retrievers.go`, registered as `loyalty_stamps`.
- Migration 0120 swaps the `wa_rag_tools_retrieval_type_chk` to allow `loyalty_stamps` and `recipe_availability` (the latter had been seeded in 0043 but the Drizzle schema was still out of sync with the CHECK) and seeds the "Kartu Stempel" platform-default row at `min_tier='komplit'`, `trigger_mode='on_customer_match'`, `sort_order=75`.
- Admin "Daftar RAG Tools" page + the Zod input validator updated to allow the new types so platform admins can edit them via the UI.

Tenant-side enable list is data-driven from `wa_rag_tools` — the new "Kartu Stempel" row appears automatically once the migration runs; tenants just toggle it on in their WhatsApp settings.
