---
"@vintra/web": patch
"@vintra/mobile": minor
---

Phase 3 of mobile POS: auto-promo preview in the checkout cart.

Auto-promos (product / product-set / category triggers) were already
applying server-side in `createSale`, so the *charge* was correct — but the
mobile cart showed the gross subtotal until after submission, and the
cashier couldn't quote the discounted price. Now the cart breakdown shows
one row per matching promo (`Promo · <name> · −Rp X`) and the Total + cash
calculator subtract those amounts so the cashier sees what the server will
actually charge.

- `listActivePromotions` allowlisted in the mobile gateway (one-liner;
  server fn already shipped for web).
- New `apps/mobile/src/lib/promos.ts` with `useActivePromotions` +
  `computeAutoPromoAmount` + `pickAutoPromoForLine` + `computeAutoPromos`.
  The two helpers are pure functions ported verbatim from
  `apps/web/src/components/pos/cashier-cart.tsx` (same tie-break,
  same percent rounding, same maxDiscountAmount cap) so the mobile preview
  and the server resolution can't drift.
- `CartLine` gains `categoryId` so category-scoped promos resolve without
  needing a catalog re-lookup at preview time.
- Checkout cart card now renders the per-promo discount rows above the
  redeem row; grandTotal = subtotal − Σ auto promos − redeem (matches the
  server's resolution chain).

Out of scope for Phase 3: code-mode promos (cashier-typed code), manual
line/cart discount, kasbon — same deferred list as Phase 1.
