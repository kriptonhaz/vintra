# @vintra/mobile

## 0.1.2

### Patch Changes

- Updated dependencies [1b74cc5]
- Updated dependencies [7e01ea5]
- Updated dependencies [d6e7186]
  - @vintra/shared@0.4.0

## 0.1.1

### Patch Changes

- @vintra/shared@0.3.0

## 0.1.0

### Minor Changes

- a2f8a1f: Mobile Absensi tab now mirrors the web's manager view for tenant owners + admins. Members with `attendance.manage` see today's stats (on-time / late / belum) and a paginated records list scoped to the active outlet — tap a row to expand and view check-in/out photos (with fullscreen viewer) and GPS coords (Google Maps link). Staff without the permission still see the existing check-in flow. Exposes `getAttendanceDashboardStats`, `listAttendanceRecords`, and `listAttendanceStaff` via the mobile gateway.
- a2f8a1f: Phase 3 of mobile POS: auto-promo preview in the checkout cart.

  Auto-promos (product / product-set / category triggers) were already
  applying server-side in `createSale`, so the _charge_ was correct — but the
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

- a2f8a1f: Mobile POS checkout grows up: customer picker + loyalty + stamps.

  The mobile cashier flow was scan → cart → pay → done with no customer attachment, no loyalty redemption, and no stamp card visibility — which made it impossible for Komplit tenants to actually use their loyalty programs from a phone. This closes that gap end-to-end.

  **Server gateway**: `searchCustomersByPhone`, `upsertCustomer`, `getCustomerLoyaltySummary`, `getCustomerStampCards`, and `getPOSSettings` added to `apps/web/src/routes/api.mobile.$fn.ts`. All four server fns already exist on web — gateway change only.

  **Mobile**:

  - New `lib/customers.ts` — hooks for search/create + loyalty summary + stamp cards + tier settings, plus a `maxRedeemablePoints` helper that mirrors the server cap so the slider/quick-picks agree with eventual submit.
  - New `components/pos/CustomerPickerSheet.tsx` — bottom sheet with phone-search + "Pelanggan Baru" inline create. Tap a hit to attach; create returns the existing row if the phone matches (server-side `ON CONFLICT DO UPDATE`).
  - `lib/cart-context.tsx` extends with `customer`, `redeemPoints`, `stampRedemptions` state. Clearing the cart (or logging out, or detaching the customer) drops all three; detaching the customer specifically also drops any redemption choices since the server would reject them anyway.
  - `app/pos/checkout.tsx` shows a customer pill (tap to open picker, X to detach) and a Loyalty + Stempel card when the tenant has the feature on AND a customer is attached. Points use quick-pick buttons (25/50/100/250/Max) instead of a slider — phone-friendly and matches the existing "uang pas" UX. Redemption discount is reflected in the displayed subtotal/Total and the "uang diterima"/change math so the cashier sees the real amount due.
  - `lib/pos.ts` extends `CreateSaleInput` with `customerName`, `customerPhone`, `redeemPoints`, `stampRedemptions`. Server is the source of truth for validation (saldo cukup, item gratis ada di cart, etc.); mobile sends nullable defaults.

  What still defers to web: manual line/cart discount, kasbon, manual promo code, dine-in/takeaway. Auto-promos already apply server-side on `createSale` but aren't previewed in the mobile cart yet (next phase).

### Patch Changes

- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [97a891b]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
- Updated dependencies [a2f8a1f]
  - @vintra/shared@0.2.0
