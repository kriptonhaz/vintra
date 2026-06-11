---
"@vintra/web": minor
"@vintra/db": patch
---

POS pricing pivot to per-outlet + mobile UX pass + a handful of post-launch fixes.

**Pricing model — per-outlet base + add-on (Qasir-aligned)**

The original flat-per-tenant Toko price (Rp 79k for up-to-2 outlets) priced 50% under Qasir's headline. Switched to: flat base covers the FIRST outlet, each additional outlet bills extra. New numbers — Toko: Rp 79k/month (Rp 65k annual) + Rp 50k/month (Rp 40k annual) per extra outlet. Bisnis (Phase 2): Rp 129k/month (Rp 105k annual) + Rp 80k/month (Rp 65k annual) per extra outlet. Multi-Outlet flat tier dropped (per-outlet pricing makes it redundant; Bisnis inherits its consolidated-reports feature). Migration `0021_billed_outlet_count.sql` adds the column to `financial_transactions`. Admin payment sheet gains a "Jumlah Outlet" input that drives the live total via `posTotal(planKey, outletCount)`.

**Free tier — unlimited everything**

Removed the 50/day transaction cap and the 30-day history clamp from Free. Both were out of step with the Indonesian market (Qasir/Loyverse give free users unlimited tx + history). `assertCanRingSale` is now a no-op shim. `posDailyCapReached` notification type retired. Conversion now relies on multi-outlet, multi-cashier, and feature gates (custom receipt, Z-report, etc.) rather than artificial caps that frustrate medium-volume free users.

**Configurable default display unit**

Migration `0020_inventory_item_units_default.sql` adds `is_default` column to `inventory_item_units`, with a partial unique index `(item_id) WHERE is_default = true` so exactly one row per item is the default. New `setDefaultUnit` server fn flips it inside a tx (unset old, set new). Item detail editor gains a "Jadikan Default" button on each unit card. Cashier card now displays price + stock in the configured default unit (was previously: cheapest tier-1 in any unit + largest unit's stock — visually inconsistent for items with multi-unit pricing).

**Jakarta TZ filter bug — dashboard finally counts today's sales**

Found via Supabase MCP investigation: `(date) AT TIME ZONE 'Asia/Jakarta'` doesn't compute "midnight Jakarta in UTC" — postgres routes through `date → timestamptz` (in session TZ) first, returning a 7-hour-off boundary that excluded morning sales. Fixed with explicit `::timestamp` cast in 6 places (`getPOSOverview`, `assertCanRingSale`, `assertCashierAllowed`, top-items query, `getDailyZReport`, `tickPOSDailyZReport`). Verified: a sale at `22:38 May 3 UTC` (= `05:38 May 4 Jakarta`) now correctly falls inside the today-window.

**Stock cap enforcement — hard block, not warning**

`UnitTierModal` clamps qty to `(stockInBase - reservedInCart) / ratio`, "+" button + Tambah ke Keranjang both disable when over. Cart line stepper does the same per-line, accounting for cross-line reservations of the same item. Server-side guard in `createSale` sums required base-qty per item across all lines and refuses with "Stok X tidak cukup" if any item exceeds the branch balance — defence-in-depth so a tampered client can't oversell.

**Cache invalidation — cashier reflects inventory edits without manual refresh**

Cashier products query now uses `staleTime: 0`, `refetchOnWindowFocus: true`, `refetchOnMount: 'always'`. Plus explicit `queryClient.invalidateQueries({ queryKey: ['pos'] })` after every inventory mutation (item update, unit add/remove, tier upsert/remove, stock movement). Editing a price in inventory then navigating back to the cashier reflects immediately.

**Print fix — iframe via blob URL**

`window.open(dataUrl)` was silently blocked by Chrome/Safari/Firefox for security. New `lib/print-pdf.ts` helper converts data URL → blob URL (same-origin) → hidden iframe → `iframe.contentWindow.print()`. Auto-revokes the blob 30s after print to avoid leaks. Same blob-URL pattern used for downloads so `download` attribute reliably triggers a save instead of inline preview.

**S3 receipt removal**

Dropped `getSaleReceiptShareUrl` server fn + `uploadPOSReceiptPDF` from `s3-storage.ts`. Receipts no longer persist to S3 (bloat with files most merchants customers never open). WhatsApp share now sends a text-only summary: tenant name, sale number, total, date. If the customer wants the actual PDF, the cashier downloads it and attaches manually.

**Inventory recordMovement bug — list query failure**

Drizzle's `sql\`... = ANY(\${array}::uuid[])\`` doesn't bind JS arrays correctly with postgres-js — receives a single value where it expects an array, query throws. Replaced with `inArray()` in 7 places across `pos.ts` (listPOSProducts × 2, createSale × 5).

**Mobile pass**

- `Dialog` now renders as a full-width bottom-anchored sheet on mobile (<md), centered card on desktop. Slides up from the bottom with a new `animate-bottom-sheet-in` keyframe + drag-handle bar at top. Affects every modal automatically: `UnitTierModal`, `PaymentModal`, `AdhocLineModal`, `SaleSuccessModal`, `ConfirmDialog`.
- Cart-line stepper buttons: `h-11 w-11` on mobile (44px iOS guideline), `h-9 w-9` on desktop. Same for qty input. Payment-method tiles `min-h-[68px] p-3.5` with `active:scale-[0.98]` haptic-feel feedback.
- Floating cart pill on the Products tab on mobile: brand-coloured bottom-anchored button showing item count + total + "Lihat →". Tap → switches to Cart tab. Pattern from Tokopedia/Shopee.
- Receipt success modal: stacked vertical buttons on mobile (full-width each), 3-col grid on tablet+. WA share is the top button on mobile (most-used path).
- Mobile cashier header split into 2 rows: branch info + tier pill on row 1, full-width Produk/Keranjang segmented control on row 2 (was: all squeezed in one row). New `SegmentButton` component replaces the old cramped `TabButton`.
- Inventory "Unit & Harga" editor: tier-add inputs stack vertically on mobile with inline labels; unit-add form same treatment + Batal/Simpan split equally.

**Minor UI fixes from feedback**

- Landing pricing tabs: equal-width via `flex-1 basis-0 min-w-0`, container `max-w-3xl → max-w-4xl` with extra padding so the active tab's brand-shadow stops bleeding outside the white pill.
- POS pricing cards centered: grid changed from `lg:grid-cols-2 xl:grid-cols-4` (which left-packed 3 cards in a 4-col grid) to `sm:grid-cols-2 lg:grid-cols-3` wrapped in `mx-auto max-w-5xl`.
- Qty input clearable: separate `qtyInput` string state in modal + cart row mirrors numeric `qty`. User can backspace to empty / type partial decimals freely; numeric state only updates on a valid positive parse. On blur, empty/invalid snaps to 1. Cart line extracted into `CartLineRow` so each line has its own input state.
- Stepper button hover/active classes properly themed for dark mode (`bg-white dark:bg-gray-800`, `hover:bg-gray-50 dark:hover:bg-gray-700`, `active:bg-gray-100 dark:active:bg-gray-600`). Disabled "+" no longer flashes white in dark mode on hover.

**Auth (still): drop SIGNED_OUT cookie clearing entirely**

Previous fix gated cookie wipe on `event === 'SIGNED_OUT'` only, but supabase-js fires SIGNED_OUT for non-user-initiated reasons in dev too (token refresh hiccup, cross-tab sync, server-refreshed cookie mismatch). Each spurious SIGNED_OUT was wiping cookies and bouncing the user to login. Removed the cookie-clearing branch from the listener entirely. Cookies now only cleared by the explicit `signOut()` callback or by the server middleware writing fresh ones on successful refresh.
