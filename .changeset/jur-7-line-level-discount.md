---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-7: Line-level discount in cashier (Toko+ feature).

The cashier already supported sale-level discount on the cart total. This adds **per-line discount** so the "tukang lapak" use case works — one item gets 10% off, others stay full price. Sale-level discount still applies on top.

**Schema** (`0026_pos_line_discount.sql`):
- `pos_sale_items.line_discount_type` (`fixed` | `percent` | NULL)
- `pos_sale_items.line_discount_value` numeric
- `pos_sale_items.line_discount_amount` numeric NOT NULL DEFAULT 0
- CHECK constraint: type ∈ {fixed, percent} when set
- `subtotal` semantics now = `qty × unit_price - line_discount_amount` (old rows have amount=0 so unchanged)

**Server** (`createSale`):
- `saleLineInput` accepts an optional `lineDiscount: { type, value }`
- Server computes the Rp amount, validates ≤ gross line total, persists all 3 columns
- Tier-gated via `assertPOSFeatureAvailable('line_discount')` — Free attempts throw

**Tier**:
- `line_discount` flag promoted from Phase 2 stub to active in `POSFeatureFlag`
- Added to `POS_TOKO_FEATURES` (inherited by Bisnis + Komplit)

**UI** (cart):
- Each cart line gets a small "%" affordance next to its price (only renders when tier has the feature flag)
- Tap → inline mini-form: `%` / `Rp` toggle + numeric input + Terapkan / Hapus / Tutup
- Applied state shows a brand-coloured pill on the % button + "Diskon item: -Rp X (Y%)" line under the price
- Gross price gets a strikethrough when line-discount is applied

**Cart math**:
- Order: line-discount → cart subtotal → sale-discount → loyalty redeem → tax → total
- Helpers `lineDiscountAmount` / `lineNetSubtotal` factor out the math; `computeTotal` (success-modal preview) follows the same order

**Receipt PDF**:
- Thermal layout adds a small "Diskon item: -Rp X" hint under each line that has a discount applied; subtotal column already reflects the post-discount value
