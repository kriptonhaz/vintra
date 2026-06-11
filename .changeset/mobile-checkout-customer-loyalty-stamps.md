---
"@vintra/web": patch
"@vintra/mobile": minor
---

Mobile POS checkout grows up: customer picker + loyalty + stamps.

The mobile cashier flow was scan → cart → pay → done with no customer attachment, no loyalty redemption, and no stamp card visibility — which made it impossible for Komplit tenants to actually use their loyalty programs from a phone. This closes that gap end-to-end.

**Server gateway**: `searchCustomersByPhone`, `upsertCustomer`, `getCustomerLoyaltySummary`, `getCustomerStampCards`, and `getPOSSettings` added to `apps/web/src/routes/api.mobile.$fn.ts`. All four server fns already exist on web — gateway change only.

**Mobile**:
- New `lib/customers.ts` — hooks for search/create + loyalty summary + stamp cards + tier settings, plus a `maxRedeemablePoints` helper that mirrors the server cap so the slider/quick-picks agree with eventual submit.
- New `components/pos/CustomerPickerSheet.tsx` — bottom sheet with phone-search + "Pelanggan Baru" inline create. Tap a hit to attach; create returns the existing row if the phone matches (server-side `ON CONFLICT DO UPDATE`).
- `lib/cart-context.tsx` extends with `customer`, `redeemPoints`, `stampRedemptions` state. Clearing the cart (or logging out, or detaching the customer) drops all three; detaching the customer specifically also drops any redemption choices since the server would reject them anyway.
- `app/pos/checkout.tsx` shows a customer pill (tap to open picker, X to detach) and a Loyalty + Stempel card when the tenant has the feature on AND a customer is attached. Points use quick-pick buttons (25/50/100/250/Max) instead of a slider — phone-friendly and matches the existing "uang pas" UX. Redemption discount is reflected in the displayed subtotal/Total and the "uang diterima"/change math so the cashier sees the real amount due.
- `lib/pos.ts` extends `CreateSaleInput` with `customerName`, `customerPhone`, `redeemPoints`, `stampRedemptions`. Server is the source of truth for validation (saldo cukup, item gratis ada di cart, etc.); mobile sends nullable defaults.

What still defers to web: manual line/cart discount, kasbon, manual promo code, dine-in/takeaway. Auto-promos already apply server-side on `createSale` but aren't previewed in the mobile cart yet (next phase).
