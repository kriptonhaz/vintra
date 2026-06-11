---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-9: Tenant promotions — codes + product auto-apply + cart auto-apply (Komplit only).

Single `tenant_promotions` table with a `trigger_type` discriminator covers all three modes — saves us from a v2 "merge promo_codes + product_promos" refactor. The DB CHECK constraint enforces "exactly one mode per row"; partial unique index on `(tenant_id, code)` enforces code uniqueness only for code-mode rows.

**Schema** (`0027_pos_promotions.sql`):
- `tenant_promotions` table (CHECK on trigger_type, partial unique on code, FK to inventory_items for auto_product, indexed for cashier hot path)
- `promo_redemptions` ledger (used for total + per-customer cap enforcement; one row per applied promo per sale)
- `pos_sales.promo_code_snapshot` + `promo_amount` (sale-level snapshot for code + auto_cart)
- `pos_sale_items.auto_promo_id` + `auto_promo_amount` (per-line snapshot for auto_product, distinct from JUR-7's `line_discount_*` so reports can split owner-set promos from cashier manual discounts)

**Server** (`promotions.ts` + `pos.ts`):
- `upsertPromotion` / `listPromotions` / `getPromotion` / `deactivatePromotion` — owner CRUD, Komplit-gated
- `listActivePromotions` — cashier client cache for auto-applied promos (auto_product + auto_cart)
- `validatePromoCode({ code, cartSubtotal, customerId? })` — debounce-safe live validation
- `createSale` integration:
  - Pre-fetches active auto_product promos and indexes by `productId` for O(1) per-line lookup
  - Auto-product promos applied per-line as `autoPromoAmount`, on top of JUR-7's lineDiscount, applied to gross-after-line-discount (multiplicative stacking)
  - Code OR auto_cart promo applied at sale-level (code wins; auto_cart picks the largest computed amount as "best for the customer" tiebreaker)
  - Order: subtotal → line_discount + auto_product → cart subtotal → sale_discount → code/auto_cart → loyalty → tax → total
  - All caps + window + min-cart re-validated server-side under tx isolation
  - One `promo_redemptions` row per applied promo per sale (sale-level + per-line)

**Tier**:
- `promo_codes` flag promoted from Phase 2 stub to active in `POSFeatureFlag`
- Added to `POS_KOMPLIT_FEATURES` only — Komplit-exclusive headline alongside loyalty

**UI — Owner** (`/pos/promos`):
- List view with active/inactive states, deactivate (soft-delete) action
- Sheet form with body that switches by trigger type (code field for code mode, product picker for auto_product, no extra fields for auto_cart)
- Live "Pratinjau: belanja Rp 100.000 → diskon Rp X" calculator
- Komplit-gated upgrade banner for non-Komplit

**UI — Cashier**:
- "Kode Promo" input above the breakdown (only renders when tier has feature + cart non-empty)
- Server validates on Bayar — error rolls the sale back, cashier sees the friendly Indonesian message in the existing onError toast
- Auto-promos work silently — server resolves and applies; cashier sees the discount on the receipt + report

**Receipt PDF**:
- Thermal + A4 layouts both now show `Promo "HEMAT20" — Rp 20.000` (or the promo name for auto_cart) as a row in the breakdown

**POS subnav**:
- New "Promo" tab gated on `promo_codes` + `pos.manage`
- Indonesian + English i18n keys added

**Out of scope** (per spec):
- Customer-segmented promos ("first-time customer only") → v2
- Cross-promo stacking rules → flat stacking only
- BOGO ("buy 1 get 1 free") → defer (different math)
- Auto-promo line label in cashier UI ("Promo Es Teh -20%") → silent for v1; visible on receipt
