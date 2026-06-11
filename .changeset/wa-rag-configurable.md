---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Configurable RAG (retrieval-augmented generation) for WhatsApp AI replies.

The `wa_subscription_plans.rag_scope` column was marketing copy until now —
the `ai:reply` worker injected no real context regardless of plan tier.
This change wires it through end-to-end with admin-managed tool definitions
and per-instance opt-in toggles.

- New `wa_rag_tools` table seeds 9 default tools across Basic and Komplit tiers:
  - **Basic**: Harga Barang, Stok Barang, Ketersediaan Menu (recipe-based, via HPP BOM), Alamat Toko, Jam Operasional, Metode Pembayaran
  - **Komplit**: Promo, Loyalty Point, Riwayat Pesanan
- Ketersediaan Menu handles F&B / cafe tenants whose menu items don't have direct stock counts — it joins `products` → `product_materials` → `inventory_items` (via `linked_hpp_material_id`) → `inventory_stock_balances` to compute max producible units per recipe. Reports the bottleneck ingredient so the AI can answer follow-ups.
- New `wa_instance_rag_tools` table holds per-instance opt-in toggles (default `false`).
- New `branches.business_hours` jsonb column for customer-facing store hours (kept distinct from `branch_schedules` which is staff attendance).
- Go `internal/rag/` package: `Retriever` interface, 8 typed retrievers, parallel dispatch with per-tool 500ms / total 1.5s timeouts.
- Tier gating enforced inside `rag.Retrieve()` so plan downgrades immediately stop running paid-tier tools — even if the per-instance toggle row says `enabled=true`.
- `MatchesKeywords` uses raw lowercase substring matching (intentionally NOT tokenized) so triggers like "harga", "stok", "jam" fire even though those words are stripped from retrieval queries by `Tokenize`.
- New admin page `/admin/rag-tools` for CRUD + reorder + live preview against any tenant's data.
- Per-instance "Konteks AI (RAG)" section in WhatsApp settings with optimistic toggles and tier-locked tools (shown but disabled with an "Upgrade ke [Tier]" badge).
- `ai:reply` worker now loads enabled tools, runs `rag.Retrieve`, injects results as a `Konteks dari sistem (gunakan jika relevan)` system message before conversation history; logs `ragToolsCount`, `snippetsCount`, `retrievalMs`.
- New `INTERNAL_SERVICE_TOKEN` env var for the TanStack-to-Go preview path. Generate with `openssl rand -hex 32`; must match on both `apps/web/.env` and `apps/api/.env`.

Free-tier tenants (no `wa_settings` row) skip retrieval entirely — RAG only fires for Basic and above.
