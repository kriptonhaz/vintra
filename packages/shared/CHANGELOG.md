# @vintra/shared

## 0.4.0

### Minor Changes

- 1b74cc5: Add Vintra AI — a business Q&A assistant over the tenant's own reports.

  The owner asks in plain Indonesian ("menu mana yang paling untung bulan ini?",
  "stok apa yang mau habis?") and the assistant answers by calling the reports it
  is allowed to read: POS sales, sales by product, cashflow dashboard and today's
  summary, inventory overview, today's attendance, and HPP margins.

  It is not a general chatbot. It can call those seven read-only functions and
  nothing else, it cannot modify data, and no chat history is stored.

  Bundled into the existing **Komplit** tier rather than given a tier of its own,
  which is how JuraganQu ships it. Vintra sells a single Rp 149.000 package, so
  stacking another price level above it would work against that — and no tenant
  is paying for the first level yet. Spend is metered per call in
  `ai_usage_logs`, so the cost of the decision is visible before it has to be
  made again.

  Two independent gates: the tier decides whether a business has the assistant,
  and `tenant_members.ai_enabled` (migration 0146, default off) decides which
  staff may use it — the assistant reads sales, cashflow and margin figures an
  owner may not want every cashier seeing. Owners always pass.

  Also capped: 50 messages per tenant per day, 4 tool-calling rounds per
  question, and tool results truncated before they reach the model.

  No new AI infrastructure was needed — the provider config, API keys and usage
  metering already existed for the logo generator; this adds the `text`
  capability lookup alongside the existing `image` one.

- 7e01ea5: Refuse to ring a POS sale at a price the cashier never saw.

  `createSale` resolves each line's price from the price list at checkout and has
  always ignored whatever the client sent — right for tamper-resistance, but it
  means a price edited mid-shift silently reprices a cart that is already open.
  The cashier says "tujuh belas ribu" out loud and the receipt prints something
  else.

  `createSale` now compares the price the cart displayed against the one it
  resolves and refuses the sale — before the stock check and before any write, so
  there is nothing to unwind — naming each item with its old and new price.
  Ad-hoc lines are exempt: their price is the cashier's own figure.

  The cashier re-prices its lines in place rather than clearing the cart or
  reloading, so nothing already rung up is lost and the next Bayar press is a
  deliberate confirmation of what is now on screen. Item ids are chunked against
  the server's 50-id cap, because truncating would leave exactly the stale prices
  this is meant to fix and loop the cashier on the same refusal.

  Both sides import `POS_PRICE_CHANGED_ERROR_PREFIX` from `@vintra/shared`, so
  they can only drift apart deliberately, not by someone rewording a sentence.

  Ported from JuraganQu (da4e695).

### Patch Changes

- d6e7186: Warn before someone quietly ends up in two tenants.

  Signing up with Google on an account that already belonged to a business never
  created a second tenant — `UNIQUE(tenants.owner_id)` makes that impossible — but it
  said nothing either. The person who pressed "Daftar" landed inside their employer's
  shop with no explanation. `ensureTenantForOAuth` now returns which tenant and role
  they already hold, and the callback shows that instead of a silent redirect to
  /dashboard.

  Only on the register path. `login.tsx` and `register.tsx` pass an identical
  `redirectTo`, so the two are indistinguishable once Google redirects back; without a
  marker the notice would greet every staff member on every login. A short-lived
  `vtr_signup` cookie, set only by the register button, carries the intent across the
  round-trip.

  Inviting someone who already works at another tenant now needs an explicit yes.
  `checkInviteEmailMemberships` gives the invite sheet the tenant names for its dialog,
  and `inviteTenantMember` rejects an unconfirmed invite server-side rather than
  trusting the UI. The invited person also gets a `member_added_to_tenant` notification
  — web has no tenant switcher yet, so a second membership is otherwise invisible to
  the one who gained it, and tenant resolution puts an owned tenant ahead of it.

  Guard applies to the email path only. Phone-only invites derive a synthetic
  `wa-{slug}-{phone}` address and `tenants.slug` is unique, so that user can never
  belong to another tenant.

  The mobile invite path is unchanged and will reject these invites until it sends the
  new `confirmExistingMemberships` flag.

## 0.3.0

## 0.2.0

### Minor Changes

- a2f8a1f: Attendance trial now runs for 14 days (was 3) and carries no staff cap by default. `ATTENDANCE_TRIAL_DEFAULTS.staffCap = null` means unlimited; the gates (`assertCanConsumeStaffSlot`, `getStaffQuota`) treat null as "no cap" instead of "blocked". Admin TrialSheet gains a "Tanpa batas staf" checkbox so a platform admin can still pin a hard ceiling per tenant if they want one. Locked-page WhatsApp pitch + tenant-detail row updated to read "Tanpa batas".
- a2f8a1f: Inventory branches model overhaul: lift Cabang to top-level, drop branch caps from paid tiers, Free locks to a single user-chosen "main branch."

  **Why** — branches are a tenant-wide resource (already shared between attendance and inventory) but the per-tier branch caps (Free 1 / Toko 2 / Bisnis 3 / Multi-Outlet ∞) conflicted whenever an attendance-paid tenant also had Free inventory. The cap was either leaky or confusing depending on the path. New model: branches are tenant-wide, paid inventory tiers have unlimited branches, and Free inventory locks to one user-chosen branch.

  **Pricing**

  - `INVENTORY_PLANS`: Toko / Bisnis / Multi-Outlet / Trial all set to `branchCap: null` (unlimited). Free stays at 1.
  - Landing + billing tier cards: paid tiers say "Semua cabang"; Free says "1 cabang utama". Multi-Outlet differentiation is now purely Phase 3 features (inter-outlet transfer, consolidated reports).

  **Schema**

  - New `main_branch_id` column on `inventory_settings` (FK → branches with `ON DELETE SET NULL`). Migration `0015_inventory_main_branch.sql` auto-back-fills the oldest active branch for existing tenants.

  **Server**

  - `ensureMainBranchId(tenantId)` — lazy default on first inventory access; no forced setup modal.
  - `assertBranchAllowedForTier()` guard inside `recordMovement` — Free tenants writing stock at a non-main branch get a friendly upgrade error.
  - New `setInventoryMainBranch({ branchId })` server fn for the dashboard picker.
  - `getInventoryOverview` returns `mainBranch: { id, name }` inline.
  - `listInventoryFormMasters` filters branches to the main one for Free tier (movement form picker hides others automatically).
  - `deleteBranch` (attendance-branches.ts) now refuses if the branch is anyone's `mainBranchId` or has any inventory stock balances — prevents silent data loss.

  **Sidebar / routing**

  - Moved `apps/web/src/routes/_authed/attendance/branches.tsx` → `apps/web/src/routes/_authed/master/branches.tsx` (top-level under Data Master). Removed the `<AttendanceSubnav />` from it.
  - Old `/attendance/branches` and `/inventory/branches` paths replaced with redirect stubs to `/master/branches`.
  - `MASTER_DATA_NAV` gets a "Cabang" entry (Building2 icon, gated by `attendance.manage`).
  - Removed the "Cabang" tab from both inventory and attendance subnavs.

  **Dashboard**

  - New "Cabang Utama" card on `/inventory` with branch name + "Ubah" button. Free tier shows the lock-in hint copy. Picker is a small dialog over `listBranches` + `setInventoryMainBranch`.

- a2f8a1f: Inventory module Phase 1 (Free + Toko tiers).

  **Free tier** (every tenant, no payment): up to 25 active SKUs, 1 branch, basic stock-in / stock-out / adjustment movements with last-30-day history, automatic HPP material price sync on stock-in. Items optionally link to existing HPP materials.

  **Toko tier** (Rp 49.000/month, Rp 39.000/month annual): 200 SKUs, 2 branches, unlimited movement history, supplier purchase orders with partial-receive, daily low-stock notification digest at 07:00 WIB, multi-unit conversions (kg/pcs/dus/lusin), bidirectional HPP cost sync.

  **Bisnis** and **Multi-Outlet** tiers ship as "Coming Soon" cards in the billing page; pricing is locked in via `INVENTORY_PLANS` so the upgrade path is visible. Variants / batch tracking / barcode / inter-outlet transfer are deferred to Phase 2 + Phase 3.

  Reuses existing infrastructure: `branches` table (multi-module), `suppliers` master, `tenant_categories`, `master_hpp_units`, `notifications` chokepoint, scheduler with new daily 07:00 WIB tick. Mirrors the attendance subscription pattern (settings table, trial-once-per-tenant, paid+trial orthogonality, financial_transactions ledger entries with `module_key='inventory'`, audit log).

  Admin tooling: trial start/end controls on the tenant detail page (paid activation deferred to follow-up — admins can issue paid activations via SQL until the inventory PaymentSheet ships).

- a2f8a1f: JUR-15 v2: per-ingredient deduct timing on HPP recipes — fixes the
  warung kopi pattern.

  Before: prep mode deducted ALL BOM ingredients at prep time, so a
  50-cup tea prep would phantom-consume 1000g sugar even though the
  cashier physically adds sugar per cup.

  Now each `product_materials` row carries an `add_at` flag ('prep' or
  'finish') set in the HPP recipe editor's new "Tahap" column. Prep
  batches only consume add_at='prep' rows; prep-mode sales also deduct
  add_at='finish' rows so per-cup additions (gula, susu, sirup) line up
  with actual inventory movement.

  - New `add_at` column on `product_materials` with CHECK constraint;
    default 'prep' keeps every existing recipe behaving exactly the same.
  - HPP recipe editor: "Tahap" column with Prep / Saat dijual dropdown.
  - `deductBomIngredients` helper gains a `phase` parameter that filters
    BOM rows by add_at. Default 'all' keeps non-prep-mode sales unchanged.
  - `recordPrepBatch` calls with phase='prep'; prep-mode sale path
    additionally calls with phase='finish' alongside the FIFO consume.

- a2f8a1f: JUR-5: Lower Toko annual + ship Komplit bundle SKU + lift Inventory Free SKU cap.

  **Pricing tweaks (visible immediately)**:

  - POS Toko Annual lowered from Rp 65k/mo → **Rp 49k/mo** (Rp 588k/year). Savings label updated to 38% off vs monthly. Beats Qasir Pro Rp 700k by Rp 112k for tenants who only want POS.
  - Inventory Free SKU cap lifted from 25 → **unlimited** (matches Qasir's free tier promise).

  **Komplit bundle (the headline product)**:

  - New POS tier `komplit` (added to `POSTierKey` + `pos_tier_chk` constraint via migration 0023).
  - Two SKUs:
    - **Komplit Monthly**: Rp 75k/mo (1st outlet), +Rp 60k/mo per extra outlet
    - **Komplit Annual**: **Rp 55k/mo (Rp 660k/year)** + Rp 45k/mo per extra outlet — 27% off vs monthly
  - Bundles POS + Inventory + Attendance + HPP at one flat price. `recordPOSPaymentAndActivate` detects Komplit plans and atomically:
    - Sets `pos_settings.tier = 'komplit'`, subscription active
    - Upserts `inventory_settings` to `'toko'` tier, subscription active (multi-unit, PO, alerts, HPP sync — same as standalone Inventory Toko)
    - Upserts `attendance_settings` with `subscriptionActive = true`, `billedStaffCount = 0` (sentinel — bundle includes unlimited staff; access middleware checks subscription only, not staff count)
    - Adds `pos`, `inventory`, `attendance` to `tenants.activeModules`
  - `POS_KOMPLIT_FEATURES` declared as superset of `POS_BISNIS_FEATURES` — includes loyalty, promo codes, line discount, kitchen display, shift management. The "to-be-built" features (W2-W5) gate at the per-feature level and throw "Coming Soon"; Komplit subscribers get them automatically when each ships, no re-billing.
  - Komplit gets `cashierCap: null` (unlimited), `branchCap: null`, `historyDays: null` — all the no-limit promises Qasir Pro makes.

  **UI updates**:

  - `/pos/billing` tier cards now show 4 tiers: Free / POS Toko / **Komplit (Populer)** / Bisnis. Komplit gets the green popular badge. New feature list explicitly calls out which Komplit features are still "Coming Soon" with asterisks (loyalty, promo, line discount, ingredient deduction, thermal printer).
  - Landing page POS pricing tab same treatment — 4-card grid with Komplit as the highlighted bundle. New copy emphasises "lebih murah dari Qasir + tanpa komitmen 24 bulan + termasuk HPP gratis".
  - Admin payment sheet (`pos-payment-sheet.tsx`) auto-includes Komplit in the plan picker dropdown via `POS_PLANS.filter(!comingSoon)`. Default selection is `pos_komplit_annual`. Plan label dropdown labels updated to clarify Toko = "POS-only" vs Komplit = "Bundle Semua Modul".
  - Server-side plan label map (`PLAN_LABEL_ID`) in admin-finance.ts adds Komplit entries for receipt emails + billing UI.

  **Tradeoff acknowledged**: Komplit subscribers immediately see "loyalty / promo / line discount / ingredient consumption / thermal printer" advertised on the bundle, but those features fire "Coming Soon" until W2-W5 ship. Documented on the billing page with a `*` asterisk legend. The trade vs delaying launch by 5 weeks: revenue starts now, early-adopter feedback shapes the parity-feature build.

- a2f8a1f: JUR-86/87: Referral program schema + admin global config UI.

  **DB (JUR-86)**

  - New migration `0052_referral_program.sql` (idempotent `IF NOT EXISTS`):
    - `referral_codes` — tenant-owned codes with discount/commission split
    - `referral_attributions` — one-per-referee attribution with window + snapshot
    - `referral_commissions` — per-payment credit events with clawback lifecycle
    - `tenant_payout_methods` — bank transfer payout info per tenant
    - `referral_claim_requests` — admin-processed payout requests
    - `referral_global_config` — single-row global knobs
    - All indexes per spec; `cap_pct numeric(5,2)`; clawback default 14 days
  - Drizzle schema `packages/db/src/schema/referrals.ts` with all 5 tables exported

  **Admin UI (JUR-87)**

  - New server functions `admin-referral-config.ts`:
    - `getReferralConfig` — reads the single config row
    - `updateReferralConfig` — updates with `WHERE id = ...`, writes audit log entry
  - New route `/admin/referrals/config`:
    - Form for cap %, window months, clawback days
    - Cap-reduction warning banner (AlertTriangle) when new cap < current cap
    - Last-updated timestamp shown below page title
  - Admin sidebar: "Konfigurasi Referral" entry under Modules section

- a2f8a1f: JUR-88: Tenant referral code management UI.

  - New route `/referrals` (under Settings in the sidebar with a Gift icon).
  - List of own codes with copy-to-clipboard, status toggle, attribution
    count, and pencil-edit action.
  - Create / edit Sheet with a live "discount + commission ≤ cap" chip that
    mirrors the server-side validation. Random-code helper button.
  - Server functions `listMyReferralCodes`, `createReferralCode`,
    `updateReferralCode`, `toggleReferralCode`, `getReferralCap` — all
    tenant-scoped via `requireAuth().tenantId`, cap re-validated on every
    mutation, code uniqueness collisions surfaced as "Kode referral sudah
    dipakai" instead of leaking the raw Postgres error.
  - The `code` field is immutable on edit so links already shared in the
    wild stay valid.
  - Empty state with onboarding copy. Mobile-responsive.

  Will show zero "Pendaftar" counts until JUR-91 (public signup capture)
  lands and zero commission until JUR-92 (payment-event wiring). Both are
  expected — the ticket is foundation work and is ready to flip on.

- a2f8a1f: JUR-91: public signup capture for referral codes. Visitors who land on
  `/` or `/auth/register` with `?ref=CODE` get the code stored in a 30-day
  `jq_ref` cookie. The register form prefills + live-validates the code
  on blur (green check / red X / referrer name). On successful tenant
  creation the attribution is written transactionally inside
  `registerWithEmail` (and `ensureTenantForOAuth` for the Google path);
  invalid / inactive / self-referral codes silently no-op so a stale
  code never blocks signup. Cookie cleared post-attribution.
- a2f8a1f: Add Phase 1 of the POS (Kasir) module — Free + Toko tiers shippable end-to-end:

  **Schema (migration 0017_pos.sql)**: 4 new tables — `pos_settings` (per-tenant subscription/trial state + receipt customisation + tax + allowed payment methods), `pos_sales` (sale header with snapshot pricing + status enum + payment method enum), `pos_sale_items` (lines, optional FK to inventory_items, with hpp_at_sale snapshot for future margin reports), `pos_sale_counters` (atomic per-tenant sale-number counter, format `JQU-YYYY-NNNNN`).

  **Server**: `requirePOSAccess` middleware mirroring inventory; `pos.ts` server functions (overview, cashier-masters, products, createSale atomic with stock movements + HPP snapshots, void with movement reversal, sales history with Free 30-day clamp, daily Z-report); `pos-receipt.ts` with jsPDF-based renderer for thermal-80mm + A4 receipt layouts and a 24h-presigned WhatsApp share URL; admin-finance extensions for `startPOSTrial`, `endPOSTrial`, `recordPOSPaymentAndActivate`, plus `recordRefund` dispatch widening for module=`pos`; 3 new scheduler ticks (trial reminder, subscription reminder, daily 23:30 Jakarta Z-report digest). Backwards-compatible widening of `inventory.recordMovement` to accept `referenceType` + `referenceId`.

  **Pricing**: `POS_PLANS` constant (Free 50tx/day + 1 cashier + Tunai/QRIS only; Toko 79k/63k flat per tenant unlimited tx + 3 cashiers + all 5 payment methods + custom receipt + sale discount + customer capture + Z-report; Bisnis + Multi-Outlet declared with `comingSoon: true` for the landing tier picker). `POS_TRIAL_DEFAULTS` = 7 days Toko-tier.

  **Notifications**: 9 POS-prefixed types (trial granted/expiring/expired, payment received, refund processed, sub expiring 7d/1d, daily Z-report ready, daily cap reached).

  **UI**: 7 new tenant-side routes (`/pos`, `/pos/cashier` with desktop split + mobile tab UX, `/pos/sales` with date+status+method filters and Z-report download, `/pos/sales/$saleId` with receipt re-print + same-day void, `/pos/settings` for logo/footer/tax/methods, `/pos/billing` 4-tier card grid, `/pos/locked`). Cashier components: product grid with category chips + stock badges, cart with qty steppers + sale-level discount + customer fields, payment modal with method picker + change calc + quick-amount presets, ad-hoc line modal, sale-success modal with WA share + PDF download + print. Admin-side `<POSModuleSection />` mounted in tenant detail page with Aktifkan/Perpanjang/Nonaktifkan + Mulai Trial flows.

  **Landing**: 4th pricing tab "Kasir (POS)" with the matching tier-card grid; `MODULES.pos` already declared at 79000.

  **Integration**: every POS sale line with an `item_id` writes an `inventory_movements` row (`movement_type='out'`, `reference_type='pos_sale'`, `reference_id=<sale_id>`) and decrements `inventory_stock_balances` atomically; void reverses with compensating `'in'` movements (`reason='pos_void'`). HPP snapshot at sale time pulls from `inventory_items.linked_hpp_product_id → products.hpp` (falls back to item cost) — forward-compat for the deferred margin report. New `jspdf` dependency.

- a2f8a1f: JUR-176: gate the Situs feature behind the Komplit bundle.

  - New `tenant_site` POS feature flag, included in
    `POS_KOMPLIT_FEATURES`. Free / Toko / Bisnis / Multi-Outlet do
    NOT have it.
  - `requireTenantSiteAccess()` middleware (combines POS access check
    - `tenant_site` feature flag). Applied to every editor server fn
      in `tenant-site.ts` (7 entry points), the analytics dashboard fn,
      and the slug claim in `public-tenant.ts`.
  - Public read path (`fetchPublicQueueDataForSlug`) now checks the
    tenant's tier via `getTenantSiteAccessForTenantId()`. Tenants who
    downgrade have their public URL go dark (404) — closes the
    "publish, cancel, keep using" loop.
  - Sidebar: `MODULE_NAV` filter now honors `item.feature`. Situs
    entry carries `feature: 'tenant_site'` so free tenants don't see
    it at all. `NavItem.feature` type added.
  - Route guards: `/site/edit` + `/site/analytics` both
    `beforeLoad`-redirect free tenants to `/dashboard`.
  - `/booking/settings` slug card swaps to a Komplit upsell card for
    free tenants. Existing claimed slug is preserved in the
    "tetap tersimpan" message so a tenant who downgrades knows they
    can re-activate without losing their URL.

- a2f8a1f: Per-tenant custom categories, mandatory onboarding flow, production quantity for accurate product-as-ingredient HPP, and UX improvements across the HPP calculator.
- a2f8a1f: Add Web Bluetooth thermal printer support for POS (JUR-12).

  When a Bluetooth thermal printer is paired in POS Settings → Printer Thermal, the Cetak button on the cashier success modal streams ESC/POS bytes straight to it via BLE GATT instead of opening the browser print dialog. Tested against a 58mm RPP02N. Supports 58mm and 80mm paper widths, dithered tenant logo (Floyd-Steinberg), multi-tax breakdown, loyalty footer, and partial cut. Falls back to the existing PDF receipt flow on unpaired devices and on browsers without Web Bluetooth (iOS Safari, Firefox).

  - New `thermal_printer` POS feature flag, included in Toko + Komplit tiers. Free tier keeps PDF-only.
  - Per-device pairing (localStorage `jq_pos_thermal_printer`) — different cashier tablets can pair different printers.
  - Server function `getSaleDataForPrinter` returns the same sale payload the PDF renderer uses, as JSON, with the tenant logo as a base64 data URL for client-side dithering.
  - ESC/POS lib at `apps/web/src/lib/escpos/` (commands, dither, render-receipt) — no external dependency.
  - Web Bluetooth driver at `apps/web/src/lib/printer/bluetooth.ts` covers RPP02N's primary service plus three fallback services (ISSC UART, legacy 0xff00, generic 0x18f0) so other common ESC/POS BLE printers should pair without code changes.
  - Bluetooth Classic SPP printers are out of scope (Web Bluetooth speaks BLE GATT only).

- a2f8a1f: WhatsApp annual billing + Cashflow on the landing page.

  - **WhatsApp annual package** — admins can now record a WhatsApp module payment for a full year, not just monthly. The activation/renewal sheet (and the admin finance screen) gain a "Periode Pembayaran" selector; annual is priced at 12 months minus a flat 10% discount via the new shared `waAnnualPrice` helper. `recordWaPayment` takes a `durationMonths` (1 or 12) and sets the subscription expiry accordingly. The public pricing page shows the annual price + "hemat 10%" on each WhatsApp tier card.
  - **Landing page** — added a "Catatan Arus Kas" feature card covering the Cashflow module (income/expense ledger, customer credit, installments, P&L reports).

### Patch Changes

- a2f8a1f: Add account settings page at `/settings/account` letting logged-in users change their password. For users who only signed up via Google OAuth, the same page offers a "Set Password" form that creates an email/password identity so they can sign in either way. Server verifies the current password before allowing a change.
- a2f8a1f: Add semantic versioning with @changesets/cli, GitHub Actions release workflow, and PR changeset check.
- a2f8a1f: Admin "Catat Pembayaran Outlet Tambahan" flow + tenant hard-block becomes capacity-aware.

  When a tenant on a paid module wants to add a new branch, they get hard-blocked at `/master/branches` and routed to WhatsApp admin (prepaid model). What was missing: the admin didn't have a clean way to record the prorated payment for that extra outlet.

  This adds:

  - **New server fns** in `apps/web/src/server/functions/admin-finance.ts`:

    - `getAdditionalOutletContext` — returns the tenant's latest paid `planKey`, current `billedOutletCount`, and months remaining in the subscription period. Drives the sheet's live cost preview.
    - `recordAdditionalOutletPayment` — records a partial-window `financial_transactions` row (period: now → existing `periodEndAt`) with `billedOutletCount = previous + count`. Amount = `monthsRemaining × additionalRatePerMonth × count`. Does NOT extend the subscription — only covers the extra outlets for the remaining window.

  - **New component** `apps/web/src/components/admin/finance/additional-outlet-sheet.tsx`:

    - Loads current paid state, shows "currently billed: N outlets · ~X months remaining"
    - Input for # outlets to add
    - Live prorated cost preview (rate × months × count)
    - Standard payment capture fields (transferDate, bankRef, proof, notes)
    - Tells admin the new billed count so they can confirm with the tenant

  - **Admin tenant detail page** (`apps/web/src/routes/admin/tenants.$tenantId.tsx`): added "+ Outlet Tambahan" button next to "Perpanjang" on both POS and Inventory module cards (only shown when the module is paid+active).

  - **Tenant hard-block** at `/master/branches` is now capacity-aware. Was: any paid-tier tenant with ≥1 branch got routed to WhatsApp admin for ANY add. Now: blocks only when actual branches with a paid module enabled exceed that module's billed outlet count. After admin records an outlet-tambahan payment, the block lifts automatically and the tenant creates their branch with their own GPS/address/module toggles — no admin guesswork.

  Out of scope: Komplit-bundle auto-sync (POS-paid Komplit doesn't auto-bump Inventory billed count — admin clicks both module cards for a full-bundle outlet). Will tighten later if it becomes a friction point.

- a2f8a1f: Add admin panel for platform-level AI provider configuration, and switch
  the WhatsApp per-instance AI settings to a single "Provider — Model"
  dropdown driven by those configs.

  - New `ai_provider_configs` table stores provider credentials (name, type, model, base URL, API key, default flag).
  - Admin panel menu "AI Providers" with table view, create/edit sheet, set-default action, and delete.
  - Supports OpenAI- and Gemini-compatible providers (OpenAI, DeepSeek, Groq, Mistral, Together AI, OpenRouter, xAI, Azure, Ollama, custom) via an extensible preset dropdown; base URL is editable for self-hosted endpoints.
  - WhatsApp instance settings replace the provider/model/temperature controls with a single "Provider — Model" picker that lists active platform-configured providers. New `wa_instances.ai_provider_config_id` FK pins an instance to a specific config; null falls back to the platform default.
  - Go `ai:reply` worker resolves the provider at dispatch time: instance pin → platform default. Pinned-but-inactive configs warn and fall through to default.
  - New `GET /v1/ai/providers` returns active configs (id, name, providerType, model) for tenant UI — never exposes api_key or base_url.
  - OpenAI and Gemini adapters gain `NewOpenAIWithConfig` / `NewGeminiWithConfig` factory functions for runtime-configured base URLs.
  - `AiService` gains `CompleteWith` for dispatching to an ad-hoc provider without the static registry.

- a2f8a1f: Admin feedback inbox: replace the slide-in sheet with a dedicated detail page at `/admin/feedback/$threadId`, mirroring the tenant-side `/help/feedback/$threadId` layout.

  **Why.** The sheet was cramped for long threads — messages, the sender + email metadata, the status select, and the composer all competed for vertical space on the right edge of the screen, and once a thread had more than a few replies the message list ate the entire viewport. A full-page detail gives the reply composer room to breathe and matches the muscle memory admins already have from the tenant inbox.

  **Changes.**

  - New `apps/web/src/routes/admin/feedback.$threadId.tsx` loads via the existing `getAdminFeedbackThread` server fn. Same data, same reply/status mutations.
  - `apps/web/src/routes/admin/feedback.tsx` is now list-only: the entire sheet block, `selectedThread` state, `openThread` / `handleReply` / `handleStatusChange` handlers, and their imports (`getAdminFeedbackThread`, `replyAsAdmin`, `setFeedbackStatus`, `Sheet`, `Send`, `Mail`, `useState`, `useToast`) are gone. List rows are `<Link to="/admin/feedback/$threadId">` instead of `<button onClick={openThread}>`.
  - Detail page surfaces a back arrow to `/admin/feedback`, the `Publik` source badge + clickable mailto for public threads, the existing status select, and the same "Balasan akan dikirim ke `<email>` via email" hint above the composer that the sheet had.
  - Each message now shows its sender label (`Tim Vintra` for admin, `publicName ?? 'Tamu'` for public, `tenantName ?? 'Tenant'` for in-app) instead of only showing it on non-admin bubbles — easier to scan who said what when scrolling through a long thread.

  No server / schema changes.

- a2f8a1f: Fix `/admin/feedback/$threadId` rendering the inbox list instead of the detail page.

  In TanStack Router's flat file-based routing, `admin/feedback.tsx` and `admin/feedback.$threadId.tsx` form a parent/child pair — the child only renders if the parent has an `<Outlet />`. The previous commit (`refactor(admin-feedback): move thread detail from sheet`) kept the list page in `feedback.tsx`, so navigating to `/admin/feedback/$threadId` left the URL updated but the list was still painted, making the page look stuck.

  Split into the established `help.feedback.*` pattern:

  - `admin/feedback.tsx` is now a 13-line `<Outlet />` layout.
  - `admin/feedback.index.tsx` is the list page (matches `/admin/feedback/` — note trailing slash in `createFileRoute`).
  - `admin/feedback.$threadId.tsx` (unchanged) is the detail.

  No server / schema changes.

- a2f8a1f: Admin financial ledger — manual transactions across paid modules.

  Platform admins can now record payments and refunds with a full audit
  trail. Replaces the old raw `expiresAt` + `billedStaffCount` activation
  form with a plan-aware payment flow that creates a ledger row and
  extends the subscription atomically.

  Data model (migration 0009):

  - `financial_transactions` — append-only ledger; one row per payment
    and one linked row per refund (`status='paid' | 'refund'`,
    `refundOfTransactionId` links refunds to the original).
  - `financial_invoice_counters` — per-year monotonic sequence backing
    human-readable invoice numbers like `INV-2026-0001`. Atomic
    upsert + returning so concurrent inserts never collide.

  Tenant detail page (`/admin/tenants/$tenantId`):

  - New **PaymentSheet** with plan dropdown (1 / 3 / 6 / 12 bulan), live
    total + period preview, transfer date, bank reference, proof photo
    (S3), and notes. Used for both initial activation and renewal —
    renewals stack the new period on top of the current expiry.
  - Adjust-without-payment flow preserved for fixing typos.
  - New **Riwayat Pembayaran** section showing all of this tenant's
    transactions with a Refund action per paid row.
  - Refund sheet includes an "Akhiri langganan sekarang" checkbox —
    admin chooses per refund whether access gets cut.

  Finance page (`/admin/finance`) — cross-tenant view:

  - Summary cards: paid / refund / net / count for the filtered window
  - Filters: date range (defaults to this month), module, status,
    tenant-name search
  - Paginated table with tenant links back to the detail page
  - Shared `TransactionDetailDrawer` — proof photo via signed URL
    (5-minute TTL), linked refund/original info

  Shared pricing (`packages/shared/src/constants/pricing.ts`):

  - `ATTENDANCE_PLANS` with `pricePerStaffPerMonth` and `durationMonths`
    becomes the single source of truth for the landing page and the
    admin payment form. Changing prices = one code change, no drift.
  - `attendanceTotal(planKey, staffCount)` for server-side amount
    computation.

  Audit log gains two new action types: `finance_record_payment` (green)
  and `finance_record_refund` (amber), with metadata snapshots of plan,
  amount, invoice numbers, and whether the refund ended the subscription.

- a2f8a1f: Anggota Tim now collects a richer Qasir-style profile: first name, last name, phone, job title (jabatan), and member photo. The list shows an avatar + name + jabatan + phone + role. The form is split into "Data Anggota / Foto Anggota / Hak Akses" sections. PIN-based login + per-cashier outlet picker are intentionally omitted — Vintra uses Supabase email/password auth, and per-staff branch lives on staff_profiles. Hak Akses still uses the existing role dropdown, kept simple per request.
- a2f8a1f: asynq queues + wa-send worker + message endpoints (JUR-67, M2).

  The outbound message pipeline: HTTP → asynq queue → worker → whatsmeow → real WhatsApp.

  - **`internal/queue/queue.go`** — `Client` (producer) + `Server` (worker host) thin wrappers around `hibiken/asynq`. 3 named queues with weight-based priority (`wa:send` × 2, `wa:incoming` × 2, `ai:reply` × 1) — total 5 concurrent in-flight tasks across the process to keep RAM in check on a 2 GB VPS. Custom `RetryDelayFunc` does 5s → 25s → 125s → ... capped at 5min. Global `ErrorHandler` logs every worker failure with retry count via slog. `IsFinalAttempt(ctx)` helper exposed so handlers can branch into "mark row failed" on the last try.
  - **`internal/queue/tasks/wa_send.go`** — task type `wa:send` with `WASendPayload{MessageID}`. Handler loads the row, gets the live Connection from the registry, calls `SendText`, marks `sent` + `external_id` on success. Idempotency: if row is already `sent` (duplicate enqueue / DLQ replay), no-op. `asynq.SkipRetry` for bad payloads + bad JIDs (retrying won't help). `pgx.ErrNoRows` for a deleted row is also terminal. Final-attempt failures flip the row to `failed` with `error_message` (truncated to 500 chars) via the `IsFinalAttempt` check.
  - **`internal/whatsapp/jid.go`** — `NormalizeJID` converts user-typed phone numbers to WhatsApp JIDs (`628...@s.whatsapp.net`). Handles `+62…`, `08…` (leading 0 → 62), separators (spaces, dashes, parens). 13 test cases covering happy paths + length/character validation.
  - **`internal/db/queries/wa_messages.sql`** — 6 new sqlc queries: `CreateOutboundMessage`, `GetWaMessage`, `MarkMessageSent`, `MarkMessageFailed`, `ListMessagesForConversation`, `CreateInboundMessage` (used by JUR-68 next), `UpsertWaContact` (also JUR-68).
  - **`internal/http/handlers/wa_messages.go`** — `POST /v1/wa/instances/:id/messages` (insert pending row → enqueue → 202 Accepted with the row) and `GET /v1/wa/instances/:id/messages?jid=…&limit=50` (conversation tail). Enqueue uses a fresh 5s `context.Background` so client disconnects don't orphan tasks; if enqueue fails the row is marked `failed` inline.
  - **`internal/http/server.go`** — Deps gains `*queue.Client`, 2 new routes wired.
  - **`cmd/api/main.go`** — Constructs asynq Client + Server, registers the `wa:send` handler before starting workers. Shutdown order is now HTTP → asynq → registry: HTTP stops new requests, asynq drains in-flight workers (which may still need the registry), then registry closes sockets.

  Smoke verified after a route-wiring fix (Edit tool failures had left server.go without the message routes — caught by a 404 on POST instead of expected 401):

  - POST /v1/wa/instances/abc/messages no auth → 401
  - GET /v1/wa/instances/abc/messages?jid=x no auth → 401
  - /v1/unknown → 404 (per-route MW correctly doesn't catch unmatched paths)
  - Boot: postgres connected ✓ redis connected ✓ asynq client ready ✓ asynq server starting ✓ registry revive ✓

  `go vet` clean. 40 tests pass across 13 packages (24 in whatsapp package alone now, mostly JID parsing).

- a2f8a1f: Add Supabase JWT guard + TenantContext interceptor to apps/api (JUR-22, M1 of WhatsApp AI Backend — closes M1).

  `SupabaseJwtGuard` extracts the access token from `Authorization: Bearer` or the `sb-access-token` cookie, calls `auth.getUser()` against the same Supabase project that apps/web logs the user into, and attaches the verified `userId` to the request. `TenantContextInterceptor` then resolves the user's `tenant_members` row (mirroring the SQL pattern from `apps/web/src/server/middleware/auth.ts:256-264`) and attaches `{ userId, tenantId, role }` as `req.tenantCtx`. Controllers consume it via the `@TenantCtx()` param decorator. Both apply globally via `APP_GUARD` + `APP_INTERCEPTOR`. `@Public()` opts a route out of both — reserved for `/healthz`, `/readyz` later.

  Smoke-tested via a placeholder `GET /v1/me` controller: no token → 401, bogus token → 401, both with the expected JSON error body.

  While wiring this, switched the api runtime from `tsx` to `bun --watch src/main.ts` (dev) / `bun src/main.ts` (prod). `tsx`'s underlying esbuild does not emit full decorator metadata, which broke `Reflector` injection on the global guard. Bun has native support for `experimentalDecorators` + `emitDecoratorMetadata` and is already required on the prod box per `deploy.sh`, so this is a net simplification — `tsx` dropped from runtime dependencies.

- a2f8a1f: Supabase JWT middleware + tenant context resolution + `/v1/me` smoke endpoint (JUR-62, closes M1 Foundation).

  - **`internal/auth/verifier.go`** — Plain `net/http` GET to `/auth/v1/user` with the JWT as `Authorization: Bearer` and the secret key as `apikey`. No supabase-go SDK (avoids ~200 KB of dependency churn for what's a 40-line contract). Returns `ErrInvalidToken` for any 4xx; wraps 5xx separately so middleware can return 502 instead of misclassifying Supabase downtime as a bad token. 5 unit tests cover success, 401/403/422, 5xx, and trailing-slash base URL handling — all via `httptest.NewServer`.
  - **`internal/tenant/tenant.go`** — `Service.Get(ctx, userID)` runs the same SQL pattern as `apps/web/src/server/middleware/auth.ts:256-264` (single tenant_members lookup) and returns a `Ctx` struct. `ErrNoMembership` is the sentinel that middleware maps to 403.
  - **`internal/http/middleware/middleware.go`** — Two Fiber handlers: `Auth(*Verifier)` extracts the JWT from Authorization header OR `sb-access-token` cookie, verifies, and stores `userID` in `c.Locals` via an unexported `localKey` type (prevents collision with handler-set values). `Tenant(*Service)` resolves membership using the userID and stores the `*tenant.Ctx`. `TenantFrom(c)` is the package-level helper handlers use — panics if called on a route that wasn't through the chain (caught by Fiber's `recover` middleware).
  - **`internal/http/handlers/me.go`** — `/v1/me` returns the resolved `{userId, tenantId, role}`.
  - **`internal/http/server.go`** — Refactored to a `Deps` struct (Config + Verifier + Tenant) so subsequent tickets add subsystems by extending the struct. Critical detail: middleware is attached per-route, NOT via `v1.Use(...)`. Group-level Use would attach the chain to the whole `/v1/*` prefix including unmatched paths — a `GET /v1/typo` would return 401 instead of 404. Smoke-tested all five paths (ping=200, me no-auth=401, me bogus=401, /v1/typo=404, root=404).

  Total: `go vet` clean, 16 tests pass across 9 packages, smoke test all 5 paths return the correct status, real Supabase + local Redis connect at boot.

- a2f8a1f: Add `DbModule` + `RedisModule` to apps/api (JUR-21, M1 of WhatsApp AI Backend).

  `DbModule` re-exports the singleton Drizzle client from `@vintra/db` via the `DB_TOKEN` symbol — explicitly avoids opening a second postgres pool against the Supabase pooler. `RedisModule` provides two ioredis clients: `REDIS_DEFAULT` for producers/cache/locks, and `REDIS_BLOCKING` (a `.duplicate()` of the default) reserved for BullMQ workers' blocking commands. Both clients are configured with `maxRetriesPerRequest: null` and `enableReadyCheck: false` (BullMQ's required settings, harmless elsewhere) and quit cleanly on `OnModuleDestroy`.

  While wiring this up, `apps/api` switched from `tsc`-emitted JS in production to `tsx src/main.ts` so it can consume `@vintra/db`'s raw-TypeScript exports (`exports: "./src/index.ts"` in `packages/db/package.json`) without restructuring the package. `tsx` is now a regular dependency. Removed `tsconfig.build.json` and `nest-cli.json` since we no longer compile.

- a2f8a1f: Disconnect policy + exponential backoff reconnect (JUR-65, M2).

  - **`internal/whatsapp/disconnect.go`** — `NextDelay(attempt)` returns 1s/2s/4s/8s/16s/32s/60s/60s + 0–1000ms jitter for attempts 0–7. `MaxReconnectAttempts = 8` gives ~3 min total budget — longer than a wifi blip, shorter than waiting for an alert. Defensive clamps: negative attempts → 0, attempts > 30 → cap (defends against fuzzers / overflow).
  - **`internal/whatsapp/provider.go`** — Connection gains `reconnectMu`, `reconnectAttempt`, `reconnectTimer`, `closed`. New `scheduleReconnect()` bumps the counter, schedules via `time.AfterFunc`, emits `GiveUpEvent` when the cap is hit. `runReconnect()` re-checks `closed` under lock (Disconnect may have raced the timer), calls `Client.Connect()`, recurses on error.
  - whatsmeow's built-in auto-reconnect is now **disabled** (`Client.EnableAutoReconnect = false`) — we own the retry policy so we can surface `GiveUpEvent` and stop hammering after sustained failures.
  - `*events.Connected` handler resets the counter to 0 so the next blip starts fresh.
  - `*events.Disconnected` handler now emits `DisconnectedEvent` AND calls `scheduleReconnect()`. Registry consumers should map `DisconnectedEvent` → `status='connecting'` (we're retrying), `GiveUpEvent` → `status='disconnected'` (we stopped), `LoggedOutEvent` → `status='logged_out'` (permanent).
  - `Disconnect()` sets `closed=true` under the reconnect mu before tearing down so any in-flight reconnect timer no-ops.

  Tests (4 new):

  - `NextDelay` produces the expected growth curve + 60s cap
  - Negative attempt clamps to 0 (no panic)
  - Jitter produces ≥5 distinct delays across 50 calls at attempt=2 (smoke that jitter isn't always 0)
  - Total budget across `MaxReconnectAttempts` lands in 170–200s

  Real-phone verification gated on JUR-32.

- a2f8a1f: Full env contract for `apps/api` (JUR-69, M1 Foundation).

  `internal/config/config.go` now declares `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REDIS_URL` as required (boot exits with a readable per-key error list if any is missing). `OPENAI_API_KEY` + `GEMINI_API_KEY` remain optional — the AI adapters in JUR-33–35 will validate them at first call so a tenant who only uses one provider isn't blocked.

  Added `IsProduction()` helper for the slog handler picker and any other "behave differently in prod" branches. Five unit tests in `config_test.go` cover the defaults path, each missing-required failure, the production flag, and the empty-optional path; all use `os.Unsetenv` (not `t.Setenv(k, "")`) because caarlos0/env's `required` is a presence check — setting to empty string would falsely pass.

  Updated `apps/api/.env.example` with documented sections for runtime, Postgres (Supabase pooler note about `prepare: false`), Supabase Auth (server-only key warning), Redis (clarifies whatsmeow uses SQLite, Redis is for asynq + locks + dedupe only), and AI providers.

- a2f8a1f: Add validated env config to `apps/api` (JUR-20, M1 of WhatsApp AI Backend).

  Zod schema in `apps/api/src/config/env.schema.ts` covers `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REDIS_URL`, `OPENAI_API_KEY` (optional), `GEMINI_API_KEY` (optional), plus runtime knobs (`PORT`, `NODE_ENV`, `LOG_LEVEL`, `APP_URL`). Parsed once in `main.ts` before `NestFactory.create` — boot exits with a readable per-key error list if anything required is missing, so configuration mistakes never reach the DI container.

  `ConfigService` exposes typed access (`.get('REDIS_URL')` returns `string`, never `string | undefined`) via a `@Global()` `ConfigModule`. `dotenv/config` is imported at the top of `main.ts` so `apps/api/.env` is loaded for both `tsx watch` and `node dist/main.js`.

- a2f8a1f: Instance registry + lifecycle endpoints (JUR-66, M2).

  - **`internal/whatsapp/registry.go`** — `Registry` owns `map[instanceID]*instanceRecord` (Connection + Store) under `sync.RWMutex`. `Start(ctx, id)` is idempotent with a fast path + double-checked locking pattern: races between two callers don't leak a duplicate socket (loser disconnects + closes). `Stop` tears down both. `Get` returns `ErrInstanceNotConnected` for the send path. One SQLite file per instance under `data/{instanceID}.db` — simpler than multi-device-per-store. The registry also subscribes a `statusSubscriber` to every Connection it creates that maps event types back to `wa_instances.status` writes (fire-and-forget background ctx with 5s timeout — never block the whatsmeow hot path on Supabase round-trips).
  - **`Revive(ctx)`** — called once at boot. Queries `wa_instances` for rows in `'connected'` or `'connecting'` and calls `Start` for each. Failures log and continue (partial revive > refusing to boot).
  - **`Shutdown(ctx)`** — drains all connections + closes stores. Blocks on a `done` channel with `ctx` as the timeout. Called from `main.go` AFTER Fiber's HTTP shutdown so in-flight `/connect` waiters can still talk to the socket while it's being torn down.
  - **`internal/http/handlers/wa_lifecycle.go`** — 3 endpoints:
    - `POST /v1/wa/instances/:id/connect`: tenant-scoped ownership check, `registry.Start`, subscribes for ≤30s waiting for QR/Connected/LoggedOut/GiveUp. Returns `{status: connected}` fast-path if already up. Falls back to `{status: connecting}` on timeout so clients can poll `/status`.
    - `POST /v1/wa/instances/:id/disconnect`: tears down via `registry.Stop`, returns 204.
    - `GET /v1/wa/instances/:id/status`: live `Registry.Status` if known, else falls back to the `wa_instances` row. Always sends `lastDisconnectReason` (nullable).
  - **`internal/http/server.go`** — Deps gains `*whatsapp.Registry`; 3 new routes registered.
  - **`cmd/api/main.go`** — Constructs registry, fires `Revive` in a goroutine (don't block listener boot on a slow Supabase query), shuts down HTTP THEN registry on SIGTERM (order matters).

  Smoke verified: all 3 new endpoints 401 without auth, boot log shows the `registry revive: no instances to attach` line.

  Real-phone pairing flow remains gated on JUR-32.

- a2f8a1f: Add Postgres + Redis clients + sqlc config to `apps/api` (JUR-61, M1 Foundation).

  - **`internal/db/db.go`** — pgxpool wrapper with `DefaultQueryExecMode = pgx.QueryExecModeExec` (the workaround for Supabase's transaction-mode pooler not supporting PostgreSQL prepared statements; same constraint as `prepare: false` in apps/web's postgres-js setup). Pool sized 2–10 conns with a 5min idle timeout, plus a 5s boot-time ping so bad `DATABASE_URL` surfaces at startup rather than under traffic.
  - **`internal/redis/redis.go`** — go-redis v9 wrapper that parses `REDIS_URL`, pings with a 3s budget, and exposes `Ping(ctx)` for the future `/readyz` (JUR-41). Comment explicitly notes whatsmeow's session store is SQLite — Redis is only for asynq, locks, dedupe, and rate buckets.
  - **`sqlc.yaml`** — points schema at `packages/db/src/migrations` (the Drizzle-generated SQL) and queries at `internal/db/queries/`. `emit_prepared_queries: false` so the generated code aligns with the pooler constraint; `emit_interface: true` for easier mocking in tests. Queries are added feature-by-feature starting with JUR-63.
  - **`cmd/api/main.go`** — opens both clients after `config.Parse()`, ping fails are boot-fatal. Both are `Close()`d on graceful shutdown via deferred cleanup.

  Smoke-tested against the real Supabase pooler + local Redis: both connect, `/v1/ping` returns 200 JSON.

- a2f8a1f: wa-incoming worker + Redis dedupe + contact upsert (JUR-68, closes M2 code work).

  Inbound pipeline: whatsmeow Message event → Registry hot-path filter → Redis SADD dedupe → asynq enqueue → worker → wa_messages insert + wa_contacts upsert.

  - **`internal/whatsapp/registry.go`** — `Registry` now takes `*goredis.Client` + `*asynq.Client` at construction so the new `inboundSubscriber` can do dedupe + enqueue without any DB I/O on the whatsmeow event hot path. Filters in order: `IsFromMe`, `status@broadcast`, `@g.us` (groups), `@newsletter`. Empty external IDs are dropped with a warning. Redis SADD adds to `wa:seen:{instanceId}` with a rolling 5-min TTL — fails OPEN on Redis errors (better to insert a duplicate than drop a real message; the worker's ON CONFLICT DO NOTHING handles it). `extractMessageContent` pulls text from `Conversation`/`ExtendedTextMessage` and falls back to type-only persistence for image/video/document/audio/sticker (richer media in JUR-45).
  - **`internal/whatsapp/registry.go`** — new `lookupTenantID(ctx, instanceID)` helper that uses a new sqlc query `GetInstanceTenantID` (bypasses tenant scoping — used by registry only to package the tenant_id into the inbound payload, never by HTTP callers).
  - **`internal/db/queries/wa_instances.sql`** — added `GetInstanceTenantID` (`SELECT tenant_id FROM wa_instances WHERE id = $1`). Generated code includes the new method on the Querier interface.
  - **`internal/queue/tasks/wa_incoming.go`** — handler unmarshals `InboundPayload`, inserts via `CreateInboundMessage`, upserts via `UpsertWaContact`. Returns `asynq.SkipRetry` for bad payloads + UUID parse errors. TODO comment for the M3 `ai:reply` enqueue hook.
  - **`cmd/api/main.go`** — reordered: asynq client/server constructed BEFORE registry (which now needs them); registers both `wa:send` and `wa:incoming` task handlers on the mux before `Run`.

  Boot smoke verified: `postgres connected → redis connected → asynq client ready → api listening → asynq server starting → registry revive: no instances to attach` — clean lifecycle with all 4 subsystems wired.

  The actual end-to-end inbound message flow (real phone sends message → row appears in wa_messages within 1s, no duplicates after reconnect, groups not persisted) is gated on JUR-32 manual e2e.

  `go vet` clean, 40 tests pass across 13 packages.

- a2f8a1f: `wa_instances` CRUD endpoints + first sqlc usage (JUR-63, M2).

  - **`internal/db/queries/wa_instances.sql`** — 7 named queries: Create, ListByTenant, Get, partial Update (COALESCE + sqlc.narg pattern so callers patch only the fields they care about), Delete, plus two helpers that JUR-65/JUR-66 will consume (UpdateWaInstanceStatus, ListWaInstancesForRevival).
  - **`internal/db/queries/generated/`** — sqlc-generated Querier interface + WaInstance struct + handler functions. ~1050 LOC committed (deterministic from schema + queries, but checked in so downstream consumers don't need sqlc locally; regenerate with `sqlc generate` from `apps/api/`).
  - **`internal/db/uuid.go`** — tiny `ParseUUID`/`UUIDString` helpers bridging pgtype.UUID ↔ canonical hyphenated string form at HTTP boundaries.
  - **`internal/http/handlers/wa_instances.go`** — 5 Fiber handlers + request/response DTOs. Response DTO flattens pgtype.X into plain JSON (the generated struct would otherwise serialize as ugly `{bytes,valid}` nested objects). Hard tenant scoping on every query; cross-tenant access returns 404 (not 403) per the canceled ticket's "don't leak which is which" guidance. Inline validation: label 1–100 chars, aiProvider must be openai|gemini, aiMaxHistory 1–50, PATCH requires ≥1 field.
  - **`internal/http/server.go`** — Deps now includes `*queries.Queries`; routes registered per-method with explicit auth+tenant middleware.

  Smoke verified:

  - `POST /v1/wa/instances` no auth → 401
  - `GET /v1/wa/instances` no auth → 401
  - `PATCH /v1/wa/instances/abc` bogus token → 401 (auth runs before path validation)
  - `/v1/wa/unknown` (no route) → 404 (per-route middleware doesn't catch unmatched paths)

  `go vet` clean, 16 tests pass across 10 packages.

- a2f8a1f: whatsmeow provider with SQLite session store + typed events (JUR-64, M2).

  The core WhatsApp gateway. Pure-Go all the way down — `go.mau.fi/whatsmeow` for the protocol, `modernc.org/sqlite` for the session store (so `CGO_ENABLED=0` static builds keep working), `skip2/go-qrcode` to render the pairing payload as a PNG data URL.

  - **`internal/whatsapp/store.go`** — `Store` wraps `*sqlstore.Container`. Opens `data/whatsmeow.db` with WAL + foreign keys via modernc's URI-PRAGMA syntax. Auto-creates the parent directory. Includes a thin slog↔whatsmeow log bridge so whatsmeow's internal logs flow into our structured slog output with a configurable verbosity floor.
  - **`internal/whatsapp/provider.go`** — `Connection` wraps `*whatsmeow.Client` per instance with sync-safe `Status()`, a Subscribe/emit fanout for typed events, and `SendText(ctx, jid, body) (externalID, error)`. `Connect(ctx)` branches on `Client.Store.ID == nil`: fresh devices spin up the QR channel goroutine; pre-paired devices just resume from SQLite without a QR. `handleWAEvent` translates whatsmeow's raw event vocabulary into our 6-variant `Event` interface, including treating `StreamReplaced` as logout. Hot-path discipline preserved — handlers only emit events; persistence happens downstream (JUR-66/JUR-68).
  - **`internal/whatsapp/events.go`** — Typed event sum (`QREvent`, `ConnectedEvent`, `DisconnectedEvent`, `LoggedOutEvent`, `GiveUpEvent`, `MessageEvent`). Narrow surface (~6 kinds) easier to mock than whatsmeow's full event vocab. QR events carry both the raw `Code` and a pre-rendered `DataURL` so subscribers don't need their own QR library.
  - **`internal/whatsapp/qrcode.go`** — Renders whatsmeow's pairing string to `data:image/png;base64,...` via `skip2/go-qrcode`. Medium error correction, 256×256.
  - **Tests** — 5 new (qrcode round-trip + PNG magic check, qrcode empty input rejection, store directory creation, store reopen idempotency, nil-safe Close).

  Acceptance criteria 2–5 (real phone scan, status flip, sqlite row, restart-revive, send text) are gated on JUR-32 manual e2e — requires hardware.

- a2f8a1f: Add Phase 1 of the Attendance (Absensi) module: 4 new tables (branches, branch_schedules, staff_profiles, attendance_settings), `requireActiveModule` middleware, platform-admin activation flow from the tenant detail page (Rp 5.000/staff/month, manual activation until the payment gateway epic), owner pages for branch + staff CRUD with weekly schedule editor and "Use current location" button, attendance settings page (GPS/photo/QR mode picker + QR rotation), attendance dashboard with rollup stats, and a locked-state page for tenants without an active subscription. Sets MODULES.attendance price to 5000 and adds billingUnit flag.
- a2f8a1f: Attendance Phase 2 — real clock-in / clock-out with multi-mode verification. New DB tables `attendance_records`, `qr_host_sessions`, `qr_consumed_nonces` (migration 0006). Server functions `submitClockIn` / `submitClockOut` validate ALL enabled modes simultaneously (haversine GPS check, AWS S3 photo upload, HMAC-signed QR token with one-shot nonce replay protection) and derive `on_time` / `late` / `early_leave` status in Jakarta timezone. New `/attendance/qr-host` page (owner/admin only) renders a rotating QR that auto-refreshes every `qrRotationSeconds`. Staff check-in page now orchestrates GPS / Photo / QR capture sub-components and submits proofs in one request. Photo storage uses AWS S3 with short-lived signed GET URLs. Adds deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `qrcode`, `@zxing/browser`. Requires env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`, `ATTENDANCE_QR_SECRET`.
- a2f8a1f: Attendance module trial (admin-triggered, one-time per tenant).

  Platform admin can now start a free trial for the Attendance module
  from the tenant detail page — defaults to 3 days / 2-staff cap, both
  overridable at start. Trial state lives on new columns of
  `attendance_settings` (`trial_started_at`, `trial_ends_at`,
  `trial_staff_cap`, `trial_used`). `trial_used=true` is the one-time
  gate; a second trial requires platform-admin DB intervention.

  During a trial:

  - Module access is granted (module-access guard now allows paid OR trial)
  - Staff invite cap = `trial_staff_cap` (replaces `billed_staff_count`)
  - Dashboard plan label reads "Trial · X hari lagi"
  - Billing page + admin finance show a distinct brand-colored "Trial"
    pill on the transaction row; refund action is hidden on trial rows
  - `/admin/finance` summary is unaffected (trial rows have amount=0)

  Admin can extend or shorten a running trial (new end date / cap),
  audited. Admin can also end a trial early; tenant is bounced to
  `/attendance/locked` with a trial-specific "Masa Trial Telah Berakhir"
  message on the next request.

  Trial conversion: the existing "Aktifkan" payment flow on the tenant
  detail page works unchanged — admin picks a paid plan, records a
  payment, and the subscription takes over. Staff added during trial
  stay put; the trial transaction row stays in the ledger for history.

  Shared constants: `ATTENDANCE_TRIAL_DEFAULTS` (3 days / 2 staff) and
  `TRIAL_PLAN` (with `plan_key='attendance_trial'`) live in
  `@vintra/shared`. Naming is module-scoped so POS / Inventory can
  add their own trials later without a premature per-module abstraction.

  Audit log gains three new action types:
  `attendance_trial_start` (green), `attendance_trial_update` (brand),
  `attendance_trial_end` (amber).

- a2f8a1f: Fix logout race in dev: the server-side `getCurrentUser` / `requireAuth` middleware refreshes the access-token during SSR and writes the rotated pair into cookies, but the browser-side supabase-js still had the pre-rotation tokens in `localStorage`. When its auto-refresh timer fired it sent the now-dead refresh_token, hit "refresh_token_already_used", cleared its session, and emitted `SIGNED_OUT` — the user appeared logged out even though the cookies were valid.

  `useAuthProvider` now bootstraps supabase-js's storage from the cookies on mount (via `setSession`) so its localStorage, in-memory session, and refresh timer all line up with the server's latest tokens.

- a2f8a1f: Diagnostic logs for the idle-logout investigation.

  The auth-bounce-after-hours-idle issue isn't reproducible on demand and the existing code defends every failure path I can reason about. Add structured `[auth]`-prefixed logs in `requireAuth` so the next reproduction tells us exactly which branch broke instead of guessing:

  - No access-token cookie at all
  - Access token rejected (with the supabase error message)
  - No refresh-token cookie to fall back on
  - Refresh attempt + outcome (success with user id, or failure with error message + HTTP status)

  Logs never include the actual token bytes — only presence / supabase-side error messages.

  Pull from the box with `pm2 logs vintra-web | grep '\[auth\]'` after a reproduction.

- a2f8a1f: Fix silent logout after hours of idle by eliminating the remaining refresh-token races.

  Three changes, all in the auth/refresh path:

  1. **Disable browser-side `autoRefreshToken`.** Browser supabase-js was running its own background refresh timer in parallel with the server middleware's refresh. Both consume the same single-use refresh token — whichever lost the race got `Invalid Refresh Token: Already Used` and the user bounced to login. Since every data path in this app goes through TanStack server functions (which always invoke `requireAuth`), the browser never needs to refresh on its own. The server is now the sole refresh authority; the bootstrap in `use-auth.ts` calls `setSession()` once on mount to align supabase-js's in-memory session with whatever the cookies say.

  2. **Wrap `supabase.auth.refreshSession()` in try/catch inside the coalescer.** `refreshSession()` _throws_ (rather than returning `{error}`) on `AuthRetryableFetchError` / network blips. The previous `.then(res => res)` chain didn't catch throws, so transient failures escaped out of `requireAuth` without firing the "refresh FAILED" log line — exactly what we saw in `pm2 logs` ("trying refresh" with no follow-up). Throws are now normalised into `{error: { name: 'RefreshSessionThrew', ... }}` so the middleware always logs an outcome.

  3. **Extend the coalescer success-cache from 1.5s to 30s.** The original 1.5s window handled in-burst concurrent server requests but missed the case where request B arrived AFTER request A rotated the token — B still carried the OLD refresh cookie (Set-Cookie hadn't propagated to the browser yet), saw no in-flight entry, and tried to refresh with the now-consumed token. The 30s window covers that propagation gap. Failures evict immediately so retries can attempt fresh — we never cache a known-bad outcome.

  The middleware log line now includes `source=cache|fresh` so we can verify the cache is actually doing work in production logs.

- a2f8a1f: Two auth/onboarding improvements:

  - **fix(auth):** pre-check `auth.users` for an existing row before calling `admin.generateLink({type:'signup'})`. Without this, Supabase silently re-issues a verification link for already-present (e.g. invite-flow) emails WITHOUT updating the typed password — the user would confirm and then be unable to log in because the stored hash was the old one. Now we throw "Email sudah terdaftar" up front.
  - **feat(onboarding):** add a required "Nomor HP / WhatsApp" field on the onboarding form. Phone is persisted to `tenant_members.phone` for the owner (column already existed). Better tenant contact info; renders alongside the rest of the owner profile in the existing Anggota Tim view.

- a2f8a1f: Fix three auth UX issues surfaced by Es Teh Paus Pusat (and similar tenants):

  - **Reset-password page now handles Supabase's `?error_code=otp_expired`
    redirect.** Previously, when a user clicked an expired recovery link
    Supabase would redirect to `/auth/reset-password?error=access_denied&error_code=otp_expired&...`
    and our page would ignore the query string, spin for 4s, then show a
    generic "invalid link" message. Users misread this as a Cloudflare
    error. We now read the search params upfront, render a clear
    "Link expired" state with a one-click CTA to request a new link.
  - **Login page now detects Google-SSO-only accounts on failed password
    attempts.** When `signInWithPassword` returns "Invalid credentials"
    we probe `auth.users.raw_app_meta_data->providers` via a new
    `checkLoginAuthMethod` server fn. If the user's only provider is
    Google, we show "Akun ini terdaftar dengan Google" pointing them at
    the Google button instead of letting them loop on a password they
    never set. (6 of 9 Es Teh Paus Pusat members are Google-only.)
  - **Password reset emails now go through Brevo, not Supabase SMTP.**
    Same rationale as the earlier signup-email switch: Supabase's hosted
    mailer was rate-limited. New `sendPasswordResetEmail` server fn
    calls `admin.generateLink({ type: 'recovery' })`, extracts the
    action URL, and delivers via our Brevo helper using the new
    `buildPasswordResetEmail` template. Forgot-password page no longer
    calls `supabase.auth.resetPasswordForEmail` directly. Anti-enumeration
    is preserved — we always return `{ ok: true }` regardless of whether
    the email exists.

- a2f8a1f: Fix two auth bugs surfaced in production:

  - Coalesce concurrent Supabase refresh-token calls so two server functions firing on the same page no longer race and silently log the user out with "Invalid Refresh Token: Already Used".
  - Route signup verification email through the existing Brevo integration instead of Supabase's rate-limited hosted SMTP, eliminating the "Error sending confirmation email" failure on register.

- a2f8a1f: `/auth/login` and `/auth/register` now skip the form when the caller
  already has a valid session. `getCurrentUser()` runs in `beforeLoad`;
  non-null result → redirect to `/dashboard` (or `/onboarding` if the
  tenant hasn't completed onboarding). Stops the "I look logged out but
  I'm not" UX where a stale `/auth/login` URL forces the owner to retype
  their password despite a working session.
- a2f8a1f: JUR-166: Booking Phase 1 — Core schema + slot mode (salon / barber / klinik MVP)

  **Schema (4 new tables):**

  - `booking_settings` — tenant-level config: mode, industry_template, slot_duration, working_hours jsonb, blackout_dates jsonb
  - `booking_resources` — staff/station/room resources with unique (tenant_id, name)
  - `booking_services` — services with duration, price, color; unique (tenant_id, name)
  - `bookings` — polymorphic booking rows with status lifecycle (pending→confirmed→in_progress→completed / cancelled / no_show), conflict prevention via COALESCE(end_at, start_at) overlap check

  **Industry templates:** Salon (3 staff, 30min slots), Barbershop (2 staff, 30min), Klinik (2 dokter, 15min). Hard-coded presets seeded on setup.

  **Routes:**

  - `/booking/setup` — one-time onboarding wizard, pick template → seeds resources + services
  - `/booking` — calendar with week / day / month views. Resources as columns, time slots as rows. Click-empty → create-booking sheet; click-existing → edit sheet with status transitions.

  **Permissions:** `booking.read` (view) + `booking.write` (mutate). Granted to owner/admin/supervisor. Free-tier module (no subscription gate).

  **Deferred to later phases:** Queue mode, stay mode, public booking page, WA reminders, recurring appointments, group bookings, drag-and-drop reschedule, working-hours / blackout-date enforcement.

- a2f8a1f: JUR-182 follow-up — drop auto-seed of resources and services in `completeBookingSetup`.

  Smoke-testing JUR-182 in local dev surfaced two problems with the seeded data:

  1. **Seeded services appeared as "habis" in `/pos/cashier`.** The setup wizard wrote `inventory_items` rows with `is_sellable=true` but no `inventory_stock_balances` row (services aren't stock-tracked). The POS product grid showed them as out-of-stock items the cashier couldn't select — broken-looking from the tenant's POV.

  2. **Placeholder data was misleading.** "Stylist A / B / C" resources and 5 templated services (with `cost_price=0`, no HPP linkage, no real units) forced tenants to delete + recreate everything anyway. Tenants need to set up services properly — name, price, HPP product linkage for BOM-driven stock deduction — which the setup wizard can't do correctly without the tenant's input.

  **Fix:** `completeBookingSetup` now writes only the `booking_settings` row (mode, industry_template, slot_duration_min, setup_completed=true). Resources and services come from the tenant's existing flows:

  - **Resources** (staff / station / room): added via the upcoming `/booking/settings` page (JUR-183).
  - **Services**: created as `inventory_items` in `/inventory/items` with the normal HPP / pricing / unit setup, then flagged `is_bookable=true` via the JUR-183 toggle.

  The dropped seeding logic was the 3-inserts-per-service transaction added in the JUR-182 commit (inventory_items + inventory_item_units + inventory_item_unit_pricing). The `INDUSTRY_TEMPLATES` constant stays — only `template.slotDurationMin` is read at setup time; the `services` and `resources` arrays in the templates are no longer applied to the DB but kept for the JUR-183 UI which may surface them as suggestions ("Need ideas? Salon usually has: Potong / Cat / Smoothing"). They're guidance, not auto-applied state.

  Migration not needed — the schema additions from migration 0062 (`is_bookable`, `booking_color`, `booking_duration_min`, `member_id`, `branch_id`) all stay in place; only the seeding behavior changed.

  **Tenant-visible behavior change.** A fresh `/booking/setup` now lands on `/booking` with:

  - Empty resource columns ("Tanpa Staf" fallback already renders this case).
  - Empty service picker in the create-booking sheet.

  Both gaps get proper empty-state CTAs in JUR-183.

- a2f8a1f: JUR-184 follow-up — booking settings now surfaces existing Anggota Tim with a toggle.

  The original JUR-184 staff section only read from `booking_resources`, so tenants who already had members in `/settings/members` saw an empty list and were forced to re-add everyone. The mental model is wrong: `/settings/members` should be the source of truth for "people who work here", and `/booking/settings` should be a filter view of "which of those people take bookings".

  **Server fns.**

  - **EXTEND** `getBookingSettingsState` returns three lists now: `settings`, `members` (every `tenant_members` row with role in owner/admin/supervisor/staff/cashier, LEFT-JOINed to `booking_resources` so each row carries `resourceId` indicating whether the toggle is currently ON), and `resourceOnly` (only `booking_resources WHERE member_id IS NULL` — the "tanpa akun" staff). Resources linked to members get surfaced via `members` to keep the UI from rendering the same person twice.
  - **NEW** `toggleMemberBookable({ memberId, enable })` — flips calendar visibility for an existing tenant_member. `enable=true` creates a `booking_resources` row linked via `member_id`, auto-named from `firstName + lastName`; on the rare unique-constraint collision (two members with identical names) retries with a 4-char id suffix. `enable=false` deletes the linked resource (soft-blocked when active bookings reference it). Never touches `tenant_members` — calendar visibility is decoupled from membership.
  - **SIMPLIFY** `addBookingStaff` — drops the `email` + `phone` parameters and the entire Supabase invite path. Now only writes a `booking_resources` row with `member_id=NULL`. The "invite a new team member" flow stays in `/settings/members` (canonical), no longer duplicated here. Removes the Supabase admin client + `roles` + `tenantMemberBranches` imports from this file.

  **UI rewrite (`/booking/settings` staff section).**

  Now two clearly-labeled sublists:

  - **Anggota Tim** — every eligible `tenant_members` row with a "Tampil di kalender" checkbox. Toggling on/off calls `toggleMemberBookable`. Includes role chip + phone. Empty state links to `/settings/members` for the canonical invite flow.
  - **Staf Tanpa Akun** — `booking_resources WHERE member_id IS NULL`. Name + delete. `+ Tambah staf tanpa akun` button opens a simplified sheet with just the name field.

  Sticky `+ Tambah Anggota Tim` link at the section header routes to `/settings/members` so adding a real team member is one click away.

  **Sync model (now fully symmetric).**

  - Add member in `/settings/members` → appears in `/booking/settings` Anggota Tim with toggle OFF by default. Toggle ON to make them appear in the calendar.
  - Toggle ON here → `booking_resources` row created → calendar column appears.
  - Delete member from `/settings/members` → FK from JUR-182 sets `booking_resources.member_id` to NULL → resource becomes orphaned (moves into "Staf Tanpa Akun" sublist on next page load). Calendar still shows the name; booking history preserved.

  **i18n.** Dropped: `addStaffDesc`, `staffEmailLabel`, `staffEmailHint`, `staffEmailNoPermHint`, `staffPhoneLabel`, `staffEmptyState`, `staffLinkedBadge`, `staffResourceOnlyBadge`, `staffDeactivate`, `staffActivate`, `staffIsActive`, `staffSyncHintPrefix`, `staffSyncHintLink`, `editResource`. Added: `staffSectionDesc`, `staffSectionTeam`, `staffSectionResourceOnly`, `bookableToggleLabel`, `addTeamMemberLink`, `noMembers`, `emptyResourceOnly`, `addStaffNoLogin`, `addStaffNoLoginDesc`.

  Typecheck green. No schema/migration changes.

- a2f8a1f: `/master/branches` cap reader now uses `MAX(billed_outlet_count)` across all paid `financial_transactions` rows per module instead of the latest row's value. There are two admin writers with different semantics — `recordAdditionalOutlet` writes cumulative outlet counts while `recordPOSPaymentAndActivate` writes the per-payment `outletCount` (defaulting to 1 on renewals) — so a renewal landing as `billed=1` would silently regress the cap on a tenant who had already paid for, say, 12 outlets via earlier outlet-tambahan rows. The page would then flip the "Tambah Cabang" button to the locked "Tambah Cabang via Admin" CTA even though the tenant was within their paid capacity. `planKey` is still taken from the latest paid row (it represents the current plan for the cost-preview rate). MAX is robust to whichever writer ran last and matches the "highest outlet count this tenant has ever paid for" semantic the cap is meant to enforce.
- a2f8a1f: Drop the standalone Laporan menu (sidebar entry, /finance route, dashboard card, landing footer link) and fold its rows into the POS comparison block on /pricing. Also adds a `branches.is_main` flag with a "Tetapkan sebagai Cabang Utama" checkbox on the branch form, a "Utama" badge on the branch list, and a partial unique index that enforces at most one main branch per tenant. The legacy inventory main-branch concept is migrated and kept in sync.
- a2f8a1f: Per-branch receipt footer + logo overrides.

  The receipt footer + logo lived only on `pos_settings` (one per tenant) — fine for single-outlet warungs, but multi-branch tenants on Bisnis (3 outlets) and Multi-Outlet (unlimited) were stuck printing the same address line at every counter. Misleading the moment a tenant added their second branch.

  Move both fields onto `branches` as nullable overrides; the existing `pos_settings.receipt_*` becomes the default that any branch with `NULL` inherits. Receipts render `COALESCE(branches.field, pos_settings.field)` so single-branch tenants see zero behaviour change.

  UX:

  - Single-branch tenant: settings page hides the dropdown, edits tenant default as before.
  - Multi-branch tenant: a "Berlaku untuk" picker appears. Default tab edits the tenant fallback; per-branch tabs edit `branches.receipt_*`. Empty footer in a branch tab shows "Pakai default: …" placeholder so the inheritance chain is visible. Branch logo gets a "Hapus, pakai default" link to revert to the tenant logo.

  Server: new `updateBranchReceipt` for per-branch saves; existing `uploadReceiptLogo` accepts an optional `branchId` so the upload writes to the right scope. Migration `0030_branch_receipt_overrides.sql` adds the two nullable columns to `branches`.

- a2f8a1f: Make branches a per-module-toggleable outlet primitive with additive per-location pricing.

  **Schema (0070)** — adds `branches.enabled_modules text[] NOT NULL DEFAULT ARRAY['pos','inventory','attendance']` and a new `branches.manage` permission grant to Owner + Admin. Default preserves status-quo behaviour for all existing rows (they're treated as full outlets by every module).

  **/master/branches redesign** — decoupled from the attendance module gate (POS-only and Komplit tenants can now reach the page). Each branch carries module toggles (Kasir/Stok/HR); a "Gudang" is a branch with only Stok enabled. The create/edit sheet shows a live cost-preview line ("+ Rp X/bulan akan ditagih pada perpanjangan berikutnya") computed from the new `branchCostBreakdown` helper, which sums per-module additional-location fees and uses Komplit's bundled extra-outlet rate only when the new branch is a full POS+Stok+HR bundle (partial branches fall through to à la carte rates). Free-tier tenants are hard-blocked from creating a second branch with an inline upgrade CTA.

  **Inventory pricing model** — retired the unsold `multi_outlet` flat tier in favour of additive per-location pricing on Toko (+Rp 25k/mo) and Bisnis (+Rp 50k/mo), mirroring POS's shape. New `inventoryTotal(planKey, locationCount)` matches `posTotal` API. Inventory billing page and admin InventoryPaymentSheet pick up the new "Jumlah Lokasi" input. `inter_outlet_transfer` feature flag now rolls up into Bisnis.

  **Admin drift indicator** — `getTenantBranchBillingDrift` server fn compares each module's latest paid `billedOutletCount` against the actual count of branches with that module enabled. The tenant detail page renders an amber callout when drift > 0 so admins remember to bump `outletCount` on the next renewal.

  **Soft enforcement** — paid tenants who add branches mid-cycle aren't blocked at create time; the drift card surfaces the unbilled extras for admin reconciliation. Self-service checkout for pro-rata branch upgrades is intentionally NOT in this slice.

  Out of scope: wholesale "Cabang → Outlet" rename, per-branch revenue dashboards, pro-rated mid-cycle billing. Filed as follow-ups.

- a2f8a1f: Tenant "Tambah Cabang" sheet now short-circuits when admin already recorded the outlet-tambahan payment.

  Before: even after admin recorded the prepaid payment in the admin panel, the tenant's create sheet still showed the module toggles, the live cost-preview ("+ Rp 45.000/bulan"), and the orange "Pembayaran upfront · Hubungi admin via WhatsApp" notice — all wrong, because the money is already settled.

  Now: when the tenant has unused billed capacity (`posBilledOutletCount > pos count` OR `inventoryBilledOutletCount > inventory count`), the sheet renders a "Sudah Dibayar · Outlet siap dibuat" green notice with module badges showing exactly what the admin paid for, then drops straight into the branch-detail fields (name / address / GPS / radius / isMain). The pre-filled `enabledModules` come from the unused-slot computation: POS+Inventory+Attendance for paired Komplit slots, just POS for a POS-only kiosk slot, just Inventory for a gudang slot.

  No behaviour change when the tenant has NO unused capacity — the original module-toggle + cost-preview + WhatsApp-prepaid flow still fires for first-time setup or for opportunistic "I want to add another outlet" attempts that haven't been pre-paid yet.

- a2f8a1f: Three fixes on the /master/branches page surfaced during user testing:

  - **Komplit Annual now uses the right additional-outlet rate.** The
    cost preview was hard-coding the monthly variant's Rp 60k/extra
    because `branchCostBreakdown` picked the first non-comingSoon plan
    by tier alone. A Komplit Annual tenant adding a full-bundle branch
    now sees +Rp 45k/bln (correct) instead of +Rp 60k/bln. The helper
    accepts optional `posPlanKey` + `inventoryPlanKey` hints, and
    `getBranchManagementContext` derives them from each module's latest
    paid `financial_transactions.planKey`.
  - **Prepaid-aware copy on the cost preview.** Dropped the misleading
    "akan ditagih pada perpanjangan berikutnya" line — Vintra runs
    prepaid (pay upfront then use), not postpaid. The preview now ships
    an amber notice explaining that the new branch activates after
    admin records the prorated payment, plus a WhatsApp deep-link to
    the admin so the owner can start that conversation in one click.
  - **Paid-tier creation routes through admin.** The "Tambah Cabang"
    button on the page header now becomes a WhatsApp CTA ("Tambah
    Cabang via Admin") for any tenant already at 1+ branch on a paid
    module — matching the prepaid model. Free tier keeps the upgrade
    CTA. Server-side allow-list unchanged so admin impersonation can
    still record the branch after payment lands.
  - **Summary card drops Absensi/HR.** Attendance is per-staff, not
    per-branch, so "Paket: N/A" was confusing. The HR module toggle on
    individual branches stays (still needed for GPS / schedule).
  - Header button no longer wraps to two lines when the page label is
    long — added `shrink-0` + `whitespace-nowrap`.

- a2f8a1f: Hide the cart discount card when the cart is empty. It's only actionable once items are in the cart, and rendering an editable form with no math behind it just adds visual noise to the empty state.
- a2f8a1f: Add Cashflow Monitoring Phase 1 — manual income/expense ledger (JUR-155).

  Komplit-tier tenants get a new "Cashflow" module to record money in and out of the business by hand — the foundation for later phases (POS auto-import, AR/AP, dashboard).

  - New `cashflow_categories` (shared system rows + tenant-custom rows) and `cashflow_entries` tables, migration `0077`, with 12 seeded system categories (Modal, Penjualan, Gaji, Sewa, Listrik, …).
  - New `/cashflow` ledger page: paginated table, date-range + category + type filters (defaults to the current month), and an income / expense / net summary.
  - New `/cashflow/kategori` page: CRUD for tenant-custom categories. System categories can't be edited or deleted; a category still referenced by entries can't be deleted.
  - New "Cashflow" sidebar entry, gated on the Komplit-bundled `cashflow` feature flag — non-Komplit tenants see a "Pro" lock and an upgrade gate.
  - Server functions enforce Komplit + `pos.read`; mutations refuse to touch non-manual rows so future POS-imported entries stay read-only.

- a2f8a1f: Cashflow Phase 4 — Cicilan / accounts payable (JUR-158).

  Komplit tenants can track money they owe on installment plans — supplier cicilan, equipment, recurring bills.

  - New `ap_payables` / `ap_payments` tables, migration `0079`.
  - New `/cashflow/cicilan` page: summary cards (outstanding / due this month / due next 30 days), payable cards with an expandable installment schedule, "Tambah Cicilan" (one-off or N-month — the schedule is generated up front), and "Tandai Lunas" per installment.
  - Marking an installment paid posts an `ap_payment` expense row to the cashflow ledger.
  - Past-due installments show a "Telat" badge; a daily scheduler tick notifies the owner about installments due within 3 days (mutable per payable).

- a2f8a1f: Two cashier UX fixes:

  - **Auto-collapse sidebar on `/pos/cashier`.** The cashier flow now hides the desktop fixed sidebar so the product grid + cart panel use the full screen width. The hamburger button stays visible (on every viewport) so the cashier can pop the sidebar open as a slide-in overlay anytime. Mirrors the Restro POS layout pattern.
  - **Fix customer phone lookup.** The picker / list search did `ILIKE %<input>%` against the raw input (e.g. `08118492869`), but stored phones are canonicalised to `62...` form (`628118492869`) — so the leading `0` made every desktop-typed lookup miss. We now strip the leading `0`/`62` from the search input before the ILIKE so trailing-digit lookups hit regardless of which prefix the cashier types.

- a2f8a1f: Pin the customer slot to the cart header (Restro POS pattern). Previously the "+ Tambah Pelanggan" button lived inside the scrollable middle, below the items list — on long carts (or even the empty state) the cashier had to scroll past the items to see it. Now it sits in its own non-scrolling row directly under the cart title bar, always visible.
- a2f8a1f: Per-category situs visibility. Tenants on Komplit can now untick "Tampilkan di situs publik" on a category (e.g. Bungkus / packaging supplies) so its products stay ringable at the cashier but disappear from the public storefront at `q/<slug>`. Default is visible — existing categories are unaffected. New `is_visible_on_situs` boolean on `tenant_categories`; situs query in `getPublicQueueData` now filters by it (uncategorized items still pass).
- a2f8a1f: Comp / free-access grants — Rp 0 module activation with founder approval (JUR-194).

  Platform admins can now give a tenant a module for free without it polluting revenue.

  - New `comp_grants` table + an `is_founder` flag on `platform_admins` (migration `0081`, founder seeded).
  - A comp activates the chosen module at Rp 0 with a mandatory reason and is recorded **only** in `comp_grants` — never as a `financial_transactions` row — so it never counts as income.
  - The founder can apply a comp instantly; a non-founder admin's request goes to `pending` and notifies the founder, who approves or rejects it on the tenant detail page.
  - A "Komplit" comp lights up POS + the bundled Inventory + Attendance.
  - New "Akses Gratis (Comp)" section on the admin tenant detail page: a grant form (module / tier / duration / reason) and the tenant's comp history with status + approve/reject.

- a2f8a1f: POS Peti Kas: configurable stale-session threshold (#216).

  The cashier "Sesi Kas Belum Ditutup" force-close prompt was hardcoded to
  fire once a session had been open more than 14 hours. For an outlet that
  runs ~08:00–22:00 that tripped at natural closing time every day,
  producing a phantom full-balance variance flagged as `force_closed`.

  The rule is now configurable per tenant, with an optional per-branch
  override:

  - `elapsed_hours` — stale after N hours (the previous behavior; default
    stays `14h` so nothing changes on deploy).
  - `daily_cutoff` — stale once the local clock crosses a daily boundary
    (e.g. `01:00`) and the session was opened before it, i.e. it carried
    into a new business day. An optional `minHours` guard suppresses the
    flag for sessions opened just before the cutoff.

  Data model (migration `0124_pos_cash_stale_config`):

  - `pos_settings.cash_stale_config` (jsonb, NOT NULL, tenant default —
    defaults to `{"mode":"elapsed_hours","hours":14}`).
  - `branches.cash_stale_config` (jsonb, nullable — `NULL` inherits the
    tenant default).

  `getCurrentOpenSession` resolves `branch ?? tenant` config and computes
  `isStale` via a new pure, unit-tested helper
  (`apps/web/src/server/lib/cash-stale.ts`); the cashier UI and
  `StaleSessionModal` are unchanged since the response shape is the same.
  A "Sesi Kas Kedaluwarsa" section in POS settings edits the tenant
  default. Timezone is fixed-WIB for now (multi-tz tracked in #217).

  The force-close path (zero-count) is intentionally unchanged — with a
  correct boundary it now only fires when a session genuinely carried
  overnight, where a stale physical count can't be trusted anyway.

- a2f8a1f: `importCustomers` now batches new-customer INSERTs instead of looping one-at-a-time. The previous shape did ~5,000 sequential `INSERT … RETURNING` round-trips for a 5k-row Qasir export, which took ~5 minutes — long enough that Cloudflare's `~100s` idle timeout cut the response with a 524, leaving the client crashing on `data.toCreate` even though the server's transaction had already committed (5,631 rows landed in the DB before the user saw the toast).

  Three pieces of the fix:

  1. **Batched INSERTs.** CREATEs are now grouped into a single `INSERT … VALUES (…), (…), …` per chunk of 1,000 rows. Five chunks cover a 5k-row import; one round-trip per chunk; total ~2 seconds vs. ~5 minutes. RETURNING preserves insertion order within a single statement, so mapping `inserted[k].id` back to `createIndices[start + k]` is safe even for null-phone rows that can't dedup by phone. UPDATEs stay sequential — they only fire on a re-import (rare, typically small).
  2. **Stack-safe dedup.** The in-file phone dedup pass used `parsed.push(...deduped)` which spreads each row as a separate argument and risks blowing V8's argument count limit on large arrays. Replaced with a plain `for` loop.
  3. **Defensive UI on commit.** `commitMut.onSuccess` now checks that `data` is a real object before reading `.toCreate` / `.toUpdate`. A truncated response (proxy hiccup, future timeout) shows a generic "Import selesai, refresh halaman untuk verifikasi" success toast instead of an opaque `s is undefined` error.

  Postgres caps a single query at 65,535 bound parameters; 5 columns × 1,000 rows per chunk = 5,000 params, leaving plenty of headroom for future schema growth.

- a2f8a1f: Two related improvements to `/master/customers` → Import:

  1. **In-file phone dedup.** `importCustomers` already deduped against existing DB customers but didn't dedup within the file itself. Qasir exports sometimes carry the same customer twice (e.g. cashier rang up a regular under two slightly different names — "kak Novi jts 2 (hh)" vs "Kak Novi jts 2 (an)" — both pointing at the same phone). The DB has a partial unique index on `(tenant_id, phone)` so the second INSERT used to crash the whole transaction with `Failed query: insert into "customers"...`. Now after parsing, rows are deduped by normalized phone — first occurrence wins, subsequent rows surface in the skipped list with `"Duplikat nomor HP di file (cocok dengan baris N)"` so the operator can see exactly which rows collided.

  2. **Downloadable Qasir-format template.** New `getCustomerImportTemplate` server fn builds the exact 6-column layout the parser expects (sheet `Pelanggan`, row 0 = `Subdomain | <tenant-slug>`, rows 1-2 blank padding, row 3 = headers, row 4 = one greyed-out example with `Budi Santoso / 081234567890 / 0 / 0 / 0` so first-timers see the expected types — phone forced to text so Excel doesn't strip the leading zero). The Import dialog gains an "Unduh Template" button in the file-picker step so users don't have to reverse-engineer the format from the docs.

  Tested against a real 5,751-row export: pre-fix the import crashed on the first duplicate; post-fix 5,633 unique customers go through, 118 duplicates land in the skipped panel with their line-number cross-references.

- a2f8a1f: Customer import gains an opt-in "Timpa saldo poin pelanggan yang sudah ada" checkbox in the file-picker step (`ImportCustomersDialog`). Default off — the existing safe behaviour stays the default. When ticked:

  - Existing customers' `customer_loyalty_balances.points_balance` is overwritten to the value in the spreadsheet.
  - For every overwrite, a `customer_loyalty_movements` row of type `'adjust'` is written with `points = |delta|` and reason `"Import override (yyyy-mm-dd): saldo {prior} → {new}"`, so the customer detail page's poin history records exactly what changed and when.
  - `lifetime_earned` is intentionally preserved — that's a historical earnings record, not the current balance.
  - The preview summary surfaces a new `Poin di-override` tile so the operator sees the count before committing.

  Server: `importCustomers` accepts an optional `overrideLoyalty: boolean` (default false) wired through preview + commit modes. New `poinOverridden` count returned in the summary; `poinSkippedExisting` continues to surface the count when the flag is off.

  Intended workflow: tenants migrating from Qasir at end of business day tick the checkbox so the file becomes authoritative; routine re-imports of an older export leave it off so nobody accidentally erases recent earnings.

- a2f8a1f: POS customer DB redesign:

  - Move `Pelanggan` from POS subnav to sidebar Master Data section (`/master/customers`) — it's tenant-wide reference data, not POS-specific.
  - Replace the always-visible inline customer card in the cashier cart with a compact button (no customer attached) or chip with detach (when attached). Clicking opens a phone-first picker modal (Alfamart-style): cashier types phone → existing matches surface, or inline create form lets cashier register + attach in one step. Walk-in skip button rings sale without a customer.
  - Expose POS feature flags via `getCurrentUser` so the sidebar can hide `Pelanggan` for tenants without `customer_db`.

- a2f8a1f: `/master/customers` gains server-side pagination at 25 rows per page, matching the prev/next + page-counter pattern already used on `/hpp`. Previously the page hard-coded `pageSize: 50` and rendered a single static slice with only a "narrow your search" hint at the bottom — fine for the typical merchants tenant but unworkable for a tenant who imported a 5k-customer Qasir export and needed to scroll through them. The query key now includes `currentPage`, the search input resets the page to 1 so narrowing the list never strands you on an empty later page, and `placeholderData: (prev) => prev` keeps the current page visible while the next page loads so there's no skeleton flash on flip. Pagination chrome is hidden entirely when the result set fits on one page.
- a2f8a1f: Add WhatsApp AI module card to the owner dashboard grid. Previously the dashboard listed HPP, POS, Inventory, and Attendance but not WhatsApp — so tenants who'd activated it had no entry point from the dashboard. Badge reads "Aktif" when `moduleSubscriptions.whatsapp.active` is true, "Add-on" otherwise (matches pricing-page nomenclature).
- a2f8a1f: `<DateInput>` now ships with a calendar popover. A calendar icon button sits inside the right edge of the input; clicking it opens a month grid (Indonesian month + weekday names, Sunday-start) with prev/next month navigation, "Hari ini" quick-pick, "Hapus" clear, today highlight, selected-date highlight, and disabled cells outside the existing `min`/`max` range. Outside-click closes. The strict dd/mm/yyyy text mask stays for users who prefer typing — both paths emit the same ISO `yyyy-mm-dd` so every existing call site (POS sales filter, POS reports range, cash sessions, etc.) gets the new picker automatically with no usage change.
- a2f8a1f: De-dupe the staff/member name field. `tenant_members.{firstName,lastName}` is now the single source of truth — `staff_profiles.full_name` is dropped (migration 0035 splits the legacy value at the first space and backfills the member side first). The Pegawai Absensi list, attendance records, daily summaries, and current-user displayName all derive `fullName` via the join. Anggota Tim grows a "Staf Absensi" badge for members with a profile, and a "Buat profil staf →" CTA for those without; clicking it deep-links into /attendance/staff?newForMember=… which pre-fills the create sheet and skips the Supabase invite. Sidebar label renamed "Staf" → "Pegawai Absensi" so the distinction from /settings/members is obvious.
- a2f8a1f: POS Peti Kas: default every tenant's stale cash-session rule to a 01:00
  WIB daily cutoff (#216 follow-up).

  Following the configurable-threshold change, the default is now a
  business-day cutoff at 01:00 instead of the elapsed `14h` window. A
  session opened during the day is only flagged for force-close once the
  clock passes 01:00 WIB — so the prompt no longer trips at normal closing
  time for late-evening outlets.

  Migration `0125_default_cash_stale_cutoff_0100` flips the
  `pos_settings.cash_stale_config` column default and migrates every
  existing tenant to the cutoff. `DEFAULT_CASH_STALE_CONFIG` and the
  settings-page fallback are updated to match. Tenants (and branches) can
  still switch back to `elapsed_hours` in POS settings.

- a2f8a1f: Add `docker-compose.yml` at repo root with a Redis 7 service for local dev (JUR-24, M1 of WhatsApp AI Backend).

  Postgres deliberately excluded — we use the existing Supabase project to avoid dev/prod schema drift and to save RAM on the 4 GB dev box. Redis runs with `appendonly yes` (so Baileys creds survive restarts) and `noeviction` policy so we never silently lose session data under memory pressure.

- a2f8a1f: Fix multi-user "Cloudflare error" reports on password-reset link — the actual bug was our reset-password page silently ignoring Supabase's PKCE-flow recovery URL format (`?code=…`).

  The Supabase project's email auth is set to PKCE flow, so `admin.generateLink({ type: 'recovery' })` issues links that redirect to `/auth/reset-password?code=<uuid>` instead of the legacy `#access_token=…&type=recovery` hash. Our page handled the hash form (via `setSession`) and the expired form (`?error_code=otp_expired`) but had no branch for `?code=`. The code sat there, no `PASSWORD_RECOVERY` event ever fired, and the page fell through to the 4-second timeout → generic "Link Tidak Valid" screen. Users described this as a "Cloudflare error" because that's the term they had picked up from earlier issues, but nginx logs confirmed every request returned HTTP 200 — origin was healthy the whole time.

  Fix:

  - **reset-password page** now reads `?code=` from the URL and calls `supabase.auth.exchangeCodeForSession(code)`. Success → `ready` (show the new-password form). Failure → `expired` (same UI as the explicit `otp_expired` branch). URL is scrubbed after exchange so a refresh / bookmark doesn't re-attempt the one-time code.
  - **Apex defensive redirect** (`/`) also forwards `?code=` to `/auth/reset-password` so a Site-URL fallback (when the Supabase redirect allowlist is mis-configured) still routes the user correctly.
  - Legacy `#access_token=…` hash handling stays in place for back-compat.

- a2f8a1f: Defensive redirect: when Supabase recovery emails land on the apex `/`
  instead of `/auth/reset-password` (which happens when the redirect URL
  isn't whitelisted in Supabase's URL Configuration), the landing page
  now detects the `#type=recovery` hash (or `?error=access_denied&...`
  expired-link search params) and bounces to `/auth/reset-password`
  preserving the token. The reset-password page already handles both the
  recovery flow and the expired-link error state, so the user lands on
  something useful instead of staring at the marketing landing with a
  valid token they can't use.
- a2f8a1f: Fix two issues on the password-recovery flow:

  - **Recovery hash now actually sets a session.** Our browser Supabase
    client is configured with `flowType: 'pkce'` (the modern OAuth
    path), which ignores `#access_token=…` hash fragments entirely —
    the recovery email's implicit-flow hash never produced a
    `PASSWORD_RECOVERY` event, so we'd fall into the 4 s timeout and
    show "Link Tidak Valid" even on a freshly-clicked valid link. The
    reset-password route now manually parses the hash and calls
    `setSession()` with the token pair, then clears the hash from the
    URL bar. The "expired" branch still catches `?error=otp_expired`.
  - **Forgot-password and reset-password redesigned to match brand
    theme.** Swapped the placeholder JQ tile for the real logo image,
    switched all `primary-*` colors to `brand-*` (the app's green),
    bumped to `rounded-2xl` cards with shadow, added Mail / Clock /
    AlertCircle / CheckCircle2 iconography on each stage, and added
    dark-mode classes so the pages match login.tsx visually.

- a2f8a1f: Fix tenant-duplicate-on-signup race + non-deterministic membership pick.

  Two production owners ended up with 3 tenants each, all created
  within ~30ms — classic signature of two concurrent signup requests
  both passing a "does this user already have a tenant?" check before
  either INSERT lands. One of the duplicates had a paid Komplit
  subscription that the user couldn't always reach because
  `requireAuth`'s `limit(1)` membership pick had no `ORDER BY` —
  Postgres returned whichever physical row it hit first, so the same
  user randomly landed on different tenants between requests (which is
  how the customer saw extra modules in one session and not the next).

  Three-layer fix:

  - **`apps/web/src/server/middleware/auth.ts`** — membership query
    now `ORDER BY tenant_members.created_at ASC`. Pins to the oldest
    membership (matches "your original account" intuition); stable
    even if dupes ever sneak through.
  - **`apps/web/src/server/functions/auth.ts`** — `registerWithEmail`
    pre-checks `tenants.owner_id` and returns the existing tenant
    shape on re-submit. `ensureTenantForOAuth` catches Postgres
    unique-violation (23505) and returns `{ created: false }` instead
    of bubbling a 500 to the OAuth landing page.
  - **migration 0069** — `UNIQUE(tenants.owner_id)` constraint.
    Defense in depth: even if app-level checks ever miss, the DB
    rejects the second INSERT. Applied directly to prod (was safe
    because the only 2 affected owners had been manually cleaned to
    a single tenant each beforehand).

  Multi-tenant-per-user support (legitimately running multiple
  businesses from one account) is filed as Linear JUR-186 — when that
  ships, this constraint gets dropped and replaced with a
  session-level tenant picker.

- a2f8a1f: GPS capture errors now show a localized, browser-aware help string instead of the raw spec phrase "User denied Geolocation". Previously a cashier on iPhone Chrome with the iOS-level Chrome → Location set to "Saat Aktif" would still see the unhelpful message because the per-site permission inside the browser was separate — and nothing in the UI told them to go reset it. Three call sites benefit: `/attendance` clock-in (cashier flow) plus the two GPS capture buttons on `/master/branches` create + edit.

  New `apps/web/src/lib/geolocation-error.ts` maps `GeolocationPositionError.code` to a friendly Indonesian/English message and appends a path-specific hint based on the userAgent (iOS Safari/Chrome/Firefox/Edge/Brave, Android Chrome/Samsung Internet/Firefox, desktop variants). Render targets switched to `whitespace-pre-line` so the multi-line steps wrap nicely. Error codes 2 (POSITION_UNAVAILABLE) and 3 (TIMEOUT) get their own short messages too — not just code-1 PERMISSION_DENIED.

- a2f8a1f: Fix sub-recipe BOM rows silently disappearing from HPP product edit/detail views.

  `getProductForEdit` previously used `INNER JOIN materials` which filtered out every BOM row where `material_id IS NULL` — i.e. every nested sub-product row added via the calculator's product picker. Symptoms in production (Es Teh Paus): owner added "Master Teh (5 Liter)" as a sub-recipe inside "Lemon Tea", then later it appeared to vanish from the recipe (looked like changing a category had deleted it). The rows were never actually deleted — the response query was hiding them.

  Three coordinated fixes:

  - Server `getProductForEdit` now LEFT JOINs `materials` and LEFT JOINs an aliased `products` table on `source_product_id`, returning sub-product rows with `sourceName`, `sourceHpp`, `sourceProductionQty`, and `sourceProductionUnit` populated. Material-sourced rows keep all their existing fields. The DB CHECK already enforces XOR between the two sides so callers can branch cleanly.
  - Calculator edit-mode `form.reset` now branches on `item.sourceProductId`: sub-product rows populate `productId` + derived `pricePerUnit` (`sourceHpp / sourceProductionQty`, same math as `productOptions`), and material rows keep the original mapping. This means re-opening a recipe with sub-recipes now round-trips them through `replaceProductMaterials` instead of dropping them on save.
  - Product detail dialog cost breakdown now renders sub-product rows with the source product's name and a "Sub-resep" badge, deriving the per-unit price the same way as the calculator. Mobile and desktop layouts both updated via a shared `resolveBomRowView` helper.

- a2f8a1f: Add "Duplikat" action to HPP product detail dialog.

  Clicking the new button in the product detail modal clones the product header + every BOM row in a single transaction, names the clone with the next free "Copy N" suffix across the tenant's catalog ("Teh Original" → "Teh Original Copy 1" → "Teh Original Copy 2", and duplicating "Teh Original Copy 1" still yields "Teh Original Copy 2" — the suffix detector strips an existing "Copy N" tail before allocating the next number), and navigates the user straight into the calculator pre-filled with the clone so they can edit immediately. photoKey is shared with the original (S3 objects are immutable, both rows safely reference the same image).

- a2f8a1f: Three connective fixes between HPP, Inventory, and POS.

  **Case 1 — "Jual di POS" shortcut on HPP products.** Bridging an HPP product to a sellable POS item used to mean: HPP → manually create matching inventory item → manually find + link the HPP product. Two screens, easy to forget the link. New shopping-bag icon on each HPP products row deeplinks to `/inventory/items?createFromHpp=<productId>` — the create sheet auto-opens with name copied + `linkedHppProductId` set + the HPP-link picker pre-positioned on "Produk jadi". Cashier just picks the unit, sets the price, saves.

  **Case 2 — `is_sellable` flag stops ingredients leaking into POS.** Until now `listPOSProducts` returned every inventory item with at least one priced unit, so raw ingredients (Teh Tubruk, Air Mineral) showed up in the cashier grid the moment someone gave them a price for tracking purposes. New `inventory_items.is_sellable` boolean defaults `false` for items linked to an HPP material (with no recipe link) and `true` everywhere else. Inventory form gets a "Tampilkan di POS Kasir" toggle that auto-flips when the user picks the link source, with manual override for the bahan-baku-store edge case.

  **Case 3 — pack calculator on the Modal field.** Entering "Modal Rp 0,316 per ml" forces the user to do the gallon-to-ml division by hand — the most common HPP-setup mistake (typing Rp 6.000 because that's the gallon price, not the per-ml). New "Hitung dari kemasan" expand on the Modal field accepts pack price + pack size in base units, derives the per-base price, and fills the field on confirm. Pack metadata isn't persisted — alt-units stay a post-create concern; this is just a math-helper at create time.

  Migration `0032_inventory_is_sellable.sql` adds the new column, defaults to `true`, then backfills `false` for ingredient items that don't have explicit pricing rows. Production migration applied via MCP, hash registered.

- a2f8a1f: Add optional photo support to HPP products.

  **Schema.** New nullable `products.photo_key` column (migration `0057_hpp_products_photo.sql`). Stores a Supabase Storage object key the same way `inventory_items.photo_key` does — short-lived signed URLs are minted on read, never written into the DB.

  **Upload UI.** `/hpp/calculate` step 4 (Ringkasan) gains an optional `PhotoUploadField` in place of the old static Coffee icon. The widget compresses the picked file client-side (~800px JPEG ≤500 KB) and the parent wizard fires `uploadHppProductPhotoFn` only after `createProduct` / `updateProduct` succeeds, so a photo failure can't leave the product half-created. Edit mode seeds the preview from the saved key via a signed URL.

  **Thumbnail column.** The `/hpp` "Daftar Perhitungan Produk" table replaces its first-letter avatar circle with a 40×40 image thumbnail. Visible page's photo keys are batched into a single `getHppPhotoUrls` server call so we don't fan out N round-trips per row.

  **Read-time fallback.** When `products.photo_key` is null, `getHppReport` looks up any `inventory_items` row whose `linked_hpp_product_id` points at the HPP product and surfaces its `photo_key` as `effectivePhotoKey`. This is display-only — never copied at write time, so if the link is removed the HPP product silently falls back to the placeholder. Matches the spec from the UI/UX review: "if user leaves empty on create and it's connected with POS, then the POS item's image is linked to the HPP as well."

  **Server fns added.** `uploadHppProductPhotoFn`, `removeHppProductPhoto`, `getHppPhotoUrls`. **S3 helpers added.** `uploadHppProductPhoto`, `getHppProductPhotoSignedUrl`, `deleteHppProductPhoto` (S3 key pattern `{tenantId}/hpp/{productId}.{ext}`, tag `kind=hpp-product`).

- a2f8a1f: Add platform-admin impersonation: DB-backed `active_impersonations` (one row per admin, tamper-proof), `platform_admin_audit_logs` for impersonation start/end and admin grant/revoke. Impersonation override is applied inside `requireAuth()` + `getCurrentUser()` so all server functions automatically see the impersonated tenant. Sticky amber banner across `_authed` pages with a one-click "Keluar" button. New `/admin/audit-log` page for reviewing past actions.
- a2f8a1f: Add inter-branch stock requisitions (JUR-190).

  Franchise outlets that are branches of one tenant can now order stock from the main branch inside Vintra instead of bolting on a separate tool. An outlet raises a requisition → the main branch approves → fulfillment moves stock between branches via paired `transfer_out` / `transfer_in` inventory movements, with the source-branch balance decremented and the requesting-branch balance incremented atomically.

  - New `stock_requisitions` / `stock_requisition_items` tables (+ an atomic per-tenant number counter), migration `0076`.
  - New `/inventory/requisitions` list + detail pages and a "Permintaan Stok" sidebar entry under Inventaris. Toko tier and above.
  - Branch scoping: an outlet-scoped user can only raise/cancel requests for their own branch; only a user with access to the main branch can approve or fulfill.
  - The tenant owner is notified when a requisition is raised; the requester is notified on approve / reject / fulfill.

  Transfer pricing + the Cashflow ledger integration are intentionally out of scope (tracked separately).

- 97a891b: Add internal marketing commission system: Vintra's own marketing team (members of an internal tenant) earn commission for referring paying tenants, with a head→staff hierarchy and a cap-allocation tree (global cap → head cap → per-staff budget + head override → discount + commission). Includes the agent dashboard (codes, referrals, commission, withdrawal), head team-management UI, admin marketing console, and agent payouts surfaced in the existing claims queue. Runs alongside the existing tenant-to-tenant referral via a shared, owner-abstracted pipeline.

  Also fixes two latent bugs in the referral attribution writer (silently swallowed by its best-effort handler): a `42P18` type-inference failure on the `maxClaims` param under the Supabase pooler, and a Date-binding failure in the raw `sql` template — both now use explicit casts / ISO strings.

- a2f8a1f: Inventory admin payment flow + UX polish.

  **Admin: inventory activation now goes through the same payment ledger as attendance.**

  - Replaced trial-only `InventoryModuleSection` with Aktifkan / Perpanjang / Nonaktifkan controls mirroring the attendance pattern. Trial UI removed.
  - New `InventoryPaymentSheet` (flat-priced, no per-staff field) writes a `financial_transactions` row with `module_key='inventory'`, so paid Inventory activations appear in the tenant's Riwayat Pembayaran alongside attendance.
  - New `getInventorySubscription` + `deactivateInventory` server fns (mirror attendance shapes).

  **UX**

  - Indonesian thousand-separator formatting for movement quantities (`50.000`) and `Rp` prefix for unit costs (`Rp 14`).
  - Stock per-branch badge now shows the unit label.
  - Sidebar order: HPP → Stok Barang → Absensi → POS Kasir → Laporan.
  - WhatsApp upgrade/contact links on `/inventory/billing` and `/inventory/locked` now use the canonical sales number `+62 877 6568 5391` (was a placeholder).

- a2f8a1f: Add `is_favorite` flag to inventory items so owners can pin best-sellers / staples to the top of the POS cashier grid.

  - New `is_favorite` boolean column on `inventory_items` (default false) with a partial index on `(tenant_id, name) WHERE is_favorite = true` so the cashier sort stays fast even with thousands of items.
  - Cashier `listPOSProducts` now orders by `is_favorite DESC, name ASC`. Favorites bubble to the top of the "Semua" view — inside a specific category the order is effectively unchanged (favorites within one category just sort first, alphabetically among themselves).
  - Cashier tile renders a small star badge on favorited items so the cashier can see why they're at the top.
  - Inventory item detail page (`/inventory/items/<id>`) has a new "Produk Favorit" section with a one-tap toggle (`setInventoryItemFavorite` server fn). Also exposed via the edit sheet for completeness, but the section avoids forcing the operator into the full edit flow mid-shift.

- a2f8a1f: Fix inventory items past the 50th being unreachable on the Katalog Produk / Bahan Baku page.

  The list loader fetched only the first 50 items (alphabetical), while search and the view / low-stock / bookable filters all run client-side over the loaded set. A tenant with more than 50 items couldn't see — or search for — anything past #50, including freshly-created items. The loader now fetches the full catalog (500, the input schema's ceiling), so every item renders and is searchable.

- a2f8a1f: Allow inventory items to link to a recipe-backed HPP product (JUR-10 entry point).

  Previously the inventory item form only exposed `linkedHppMaterialId` and hardcoded `linkedHppProductId: null` on submit. That meant tenants who built a recipe in HPP (e.g., "Teh Original" with 3 ingredients) had no way to bridge it to a sellable inventory item — so the JUR-10 auto-deduct flow on POS sales never had an entry point.

  The create + edit forms now show a three-way "Sumber HPP" picker (Tidak / Bahan baku / Produk jadi). Picking "Produk jadi" surfaces all HPP products plus an ingredient-count badge so the cashier knows the recipe is wired. The DB already enforced mutual exclusion via `product_materials_xor_chk`; the radio just makes the choice visible. The server-side `listInventoryFormMasters` now returns `hppProducts` alongside `hppMaterials`.

- a2f8a1f: Close the last 3 Inventory Phase 1 gaps so it can be declared done.

  **HPP downlink** — when an HPP material price changes, fire a notification (`inventory_hpp_cost_changed`) to the editor with material name, old/new price, and linked-item count. URL deeplinks to `/inventory/items?applyHpp=<materialId>`, where a new `<ApplyHppBanner>` surfaces the change and offers a one-click bulk update via the new `applyHppPriceToInventory` server fn. Includes a `previewLinkedItemsForMaterial` fn so the banner can show what would change before the user clicks apply, and a soft "all in sync" state when there's nothing to update. Idempotent (60-second `sourceKey` window) so quick double-saves don't spam two notifications.

  **Inventory refund** — generalized the existing `recordRefund` server fn to dispatch by `original.moduleKey`. Inventory refunds now correctly update `inventorySettings.subscription_active`, remove `'inventory'` from `tenants.activeModules`, fire the `inventoryRefundProcessed` notification, and email a billing-page-specific link. The TransactionsTable refund button on the admin tenant detail page already worked module-agnostically — the server-side dispatch closes the loop without any UI changes.

  **Per-item HPP-sync toggle** — new `auto_sync_hpp_cost boolean NOT NULL DEFAULT true` column on `inventory_items` (migration `0016`). Wired into the item create + edit forms as a checkbox that only renders when an HPP material is linked. The `recordMovement` HPP uplink branch and `applyHppPriceToInventory` downlink both AND-gate on this flag, so power users can keep the link visible (for traceability / discoverability) while opting out of auto-sync per item.

  i18n: 9 new keys covering the toggle label/hint, banner title/body/skipped/CTA, success toast, and the "all in sync" copy.

- a2f8a1f: Inventory Phase 1 follow-ups from first-use review.

  **Correctness**

  - Fix HPP cost-sync bug: when stock-in uses an alt unit (e.g. 1 pcs at Rp 15.000 with 1 pcs = 1.000 g), the persisted unit cost is now per-base-unit (Rp 15/g) instead of being written verbatim into HPP — previously corrupted the linked HPP material's price by the conversion ratio.
  - Branch-cap counting now reflects all active tenant branches (shared resource with attendance), not just branches with stock balances. Closes the gap where Free users could spawn unlimited branches via inventory by never recording stock at them.
  - Removed redundant per-movement branch-cap check (was firing incorrectly after the count semantic changed).

  **Guardrails**

  - Linking an inventory item to an HPP material now requires matching units. Server validates on create/update; client auto-aligns the base unit and disables Save with an inline warning if the user manually overrides into a mismatch.

  **UX**

  - Item detail: Edit + Delete actions. Delete is hard-delete when there's no movement history, otherwise falls back to deactivate (audit trail preserved).
  - Item detail: shows base unit alongside cost and min-stock figures.
  - Item detail (Toko+): manage alternate units (e.g. 1 dus = 12 pcs) directly from the page.
  - HPP material picker is now a searchable Combobox (new `apps/web/src/components/ui/combobox.tsx`).
  - Movement form: per-item unit picker (Toko+), live preview showing base-unit conversion and HPP price impact, Free-tier upgrade nudge for HPP-linked stock-ins.
  - Movements list: delete a movement with automatic balance reversal. Refuses if it would push the balance negative, and refuses PO-sourced movements (must unwind via the PO).
  - Item detail route fix: renamed `items.tsx` → `items.index.tsx` so the `$itemId` sibling route renders correctly (was matching the parent layout with no `<Outlet />`).
  - Raised `listInventoryItems.pageSize` cap from 100 to 500 so the movement form can load all SKUs as a flat picker.

- a2f8a1f: JUR-10: Auto-deduct BOM ingredients on POS sales (Toko+ feature).

  When a recipe-backed inventory item is sold, every ingredient declared in its HPP `productMaterials` BOM is now automatically deducted from inventory at the sale's branch. Mirrors Qasir Pro's "Resep" → stock flow but uses our existing HPP recipe data as the source of truth (no duplicate "Recipe" table — owners only configure recipes once).

  **Schema** (`0025_pos_ingredient_consumption.sql`):

  - `product_materials.material_id` is now nullable
  - New `product_materials.source_product_id uuid REFERENCES products(id)` for nested-recipe (sub-product) BOM rows
  - CHECK constraint: exactly one of (material_id, source_product_id) must be set per row
  - Index on `product_materials(product_id)` for the deduction-side traversal

  **Server** (`createSale` + `voidSale` in `pos.ts`):

  - New `deductIngredientsForLine` helper: walks the BOM, resolves the inventory item linked via `linkedHppMaterialId`, converts the recipe quantity to the ingredient's base unit (via `inventory_item_units.ratioToBase`), inserts an `inventory_movements` row (`reason='pos_sale_ingredient'`) + updates the balance — all in the same `db.transaction` as the sale.
  - Hard error on unit mismatch (per-design: silent skip would let stock leak invisibly).
  - Skip + per-(tenant, material) idempotent notification (`pos_unlinked_material`) when a material isn't linked to inventory.
  - Sub-product BOM rows are detected and trigger a per-(tenant, product) notification (`pos_nested_recipe_skipped`) — v1 doesn't recurse into nested recipes; v2 will.
  - `voidSale` reverses every `pos_sale_ingredient` movement with a compensating `pos_void_ingredient` `'in'` movement, keyed off `referenceType='pos_sale' + referenceId=sale.id`.
  - `createSale` returns `recipeNudge: boolean` — true when a Free-tier sale rang a recipe-backed product (cashier shows a one-time-per-session toast).

  **Tier gate**:

  - New `ingredient_consumption` flag in `POSFeatureFlag`, included in `POS_TOKO_FEATURES` (inherited by Bisnis + Komplit). Free tier configures recipes (HPP is free) but doesn't run the deduction.

  **HPP step-2 save loop** (`calculate.tsx`):

  - Sub-product cost components (where step-2 lets owners pick a product as an ingredient) are now persisted via the new `addProductSubProduct` server fn, writing `productMaterials` rows with `source_product_id` set instead of being silently dropped on the floor. Captures the structural data so v2's recursion can ship without backfill.

  **UI**:

  - Inventory item detail page: new "Stok-out otomatis saat penjualan" panel listing every recipe ingredient + its inventory link status. Unlinked materials get an inline ⚠ warning, nested-recipe sub-products get a "Coming soon" line.
  - Cashier: one-time-per-session toast on Free-tier sales of recipe-backed products inviting Toko upgrade.

  **Out of scope** (follow-up tickets):

  - JUR-14: migrate `materials.unit` / `product_materials.unit` from text to `master_hpp_units` FK (this PR uses runtime text-→-id lookup).
  - v2: traverse `source_product_id` rows recursively to deduct sub-product ingredients (one level for now is the typical merchants kafe use-case).
  - Optional receipt footer ("Termasuk: 200ml susu, 5g gula") — separate ticket.

- a2f8a1f: JUR-11: P&L / monthly report (Toko+).

  Owner-facing aggregations for any custom date range — turns the snapshot data we've been writing across W1-W4 (HPP per line, line + sale discounts, loyalty redemption, tax, ingredient cost) into a single report owners can actually see. Headline harvest ticket — no new schema, pure aggregation.

  **Server** (`getPOSReport` in `pos.ts`):

  - Single fn, takes `{ branchId?, from, to }`. Returns ringkasan + top-by-qty + top-by-revenue + payment-method breakdown + cashier breakdown.
  - All math is straight `pos_sales` + `pos_sale_items` aggregations.
  - Jakarta TZ window: `((from::date::timestamp) AT TIME ZONE 'Asia/Jakarta')` so `to + 1 day` covers the whole last day.
  - Cashier names resolved via Supabase admin API (cheap when there are few cashiers per window).

  **Tier**:

  - `pl_report` flag added to `POSFeatureFlag`, included in `POS_TOKO_FEATURES` (inherited by Bisnis + Komplit). Free still gets daily Z-report via `/pos/sales`.

  **UI** (`/pos/reports`):

  - Date-range presets (Hari ini / Kemarin / 7 hari / 30 hari / Bulan ini / Bulan lalu / Custom) + branch picker
  - Ringkasan stat grid (Pendapatan, HPP, Untung kotor, Margin %, Diskon item/cart, Pajak, Tukar poin, Sales/Voided counts + total)
  - Top 10 items — by qty + by revenue, side-by-side on desktop
  - Payment method breakdown (count + % + total)
  - Cashier breakdown (rendered only when ≥2 distinct cashiers in the window)
  - Free-tier upgrade banner when feature is missing

  **Export** (client-side, no extra round-trip):

  - CSV via plain text generation (escaped quotes for names with `,` or `"`)
  - PDF via existing `jspdf` dep — A4 layout with Ringkasan + Top 10 + Payment + Per-Kasir sections, auto-paginated

  **POS subnav**:

  - New "Laporan" tab (gated on `pl_report` feature flag, requires `pos.read` permission)
  - Indonesian + English i18n keys added

- a2f8a1f: Centralize the sales WhatsApp phone number (JUR-127):

  The `6287765685391` number was duplicated across 11 files as a `const WA_PHONE = '...'`. The original placeholder `628123456789` (caught and fixed previously) routed every "Hubungi Sales" / "Aktifkan" CTA into the void — so this consolidation prevents the next phone-number-typo bug.

  - New exports in `apps/web/src/lib/constants.ts`:
    - `SALES_WHATSAPP_PHONE` — the digits-only number
    - `buildSalesWaUrl(message)` — returns `https://wa.me/${SALES_WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`
  - All 11 call sites switched over; `bun run typecheck` is green.

- a2f8a1f: JUR-13: Launch wrapper — help center + onboarding tour + `/vs-qasir`.

  The harvest of W1–W5: shipped features need surfaces where new owners discover them. This ticket lands all three:

  **Help center** (`/help`, `/help/$slug`):

  - 8 articles in Indonesian covering the full feature surface (cashier basics, inventory + tier pricing, recipes + ingredient deduction, loyalty, promo, multi-outlet, thermal print, tax + discount math)
  - Articles stored as TS modules in `apps/web/src/lib/help-articles.tsx` (no DB, no markdown parser dep — JSX bodies render directly)
  - Index page groups by category (Mulai / Kasir / Inventaris / Penjualan / Lanjutan)
  - Article pages have prev/next nav + back-to-index + reading-time estimate
  - New `.article-prose` CSS scope in `app.css` for clean Indonesian long-form typography

  **Onboarding tour** (dashboard):

  - 5-step modal walkthrough: HPP → Inventaris → Resep → Kasir → WhatsApp share
  - Auto-fires on first dashboard visit per (browser, tenant) — localStorage flag prevents repeat
  - Re-launchable from new "?" icon in dashboard header
  - Each step includes deep-link CTA ("Buka HPP", etc.) so the owner can actually go try the feature
  - No library dep — ~150 lines of plain React (full-screen modal sequence, not anchored tooltips)

  **`/vs-qasir`** comparison page:

  - Public route (no auth). Direct-conversion landing for tenants evaluating us against the obvious competitor
  - Hero + dual pricing card (Qasir Rp 700k vs Komplit Rp 660k) + feature comparison table (11 rows, with rows highlighting Vintra's clear wins)
  - Dual CTAs: "Coba Gratis Sekarang" → /auth/register + "Konsultasi Migrasi" → WhatsApp deep-link
  - Migration callout block + bottom CTA

  **Landing nav**:

  - Default nav links updated: Harga / Bandingkan vs Qasir / Bantuan (overrideable via `navLinks` prop on each page that uses `LandingNavbar`)

  **Out of scope** (per spec):

  - Smoke test + production deploy + email/WA announce — handled separately by founder

- a2f8a1f: Fix React #418 hydration on /referrals/pendaftar + /referrals/commission (JUR-131):

  `formatDate` in `lib/utils.ts` used date-fns `format()` which reads the runtime's local timezone. SSR runs in UTC on the Lightsail box; clients run in Asia/Jakarta (+7). For any timestamp falling between 17:00–24:00 UTC, the two environments render different calendar dates, which fires React #418 on every page rendering server-loaded dates.

  JUR-97 was supposed to fix this by migrating away from `toLocaleDateString`, but the date-fns replacement carried the same TZ-naïve bug.

  Switched `formatDate` to `date-fns-tz`'s `formatInTimeZone(d, 'Asia/Jakarta', pattern, { locale: id })`. Pins the formatter to WIB so the rendered wall-clock is identical regardless of where the JS runs. Vintra is Indonesia-only, so pinning is semantically correct for every existing caller — no per-call migration needed.

  Adds `date-fns-tz@3.2.0` dep.

- a2f8a1f: JUR-135 PR 2 — enforce per-member branch scoping across POS + Inventory:

  PR 1 wired `tenant_member_branches` storage + the owner UI. This PR turns on the gating: a member pinned to "Cabang BSD" now sees only Cabang BSD's sales, stock, movements, and reports. Cross-branch URL hits return "tidak ditemukan" rather than leaking the row's existence.

  **New helpers** (`apps/web/src/server/lib/branch-scope.ts`):

  - `assertBranchAllowed(auth, branchId)` — throws for restricted members; no-op for owners + pre-JUR-135 unrestricted callers (where `allowedBranchIds === null`).
  - `filterBranchesByAccess(auth, branches)` — returns the input unchanged when unrestricted.
  - `branchScopeWhere(auth, column)` — Drizzle SQL clause that spreads into `and(...)` cleanly; returns `undefined` when unrestricted so callers don't add tautologies. Empty allowed-list yields `IN (NULL)` as a defensive no-leak fallback.

  **POS** (`apps/web/src/server/functions/pos.ts`):

  - `getPOSCashierMasters` filters `branches[]` by member access AND now exposes `branchAccessRestricted: boolean` so the cashier UI distinguishes "tenant has 0 branches" from "you're not pinned to any branch".
  - `getPOSOverview` raw SQL gains a branch-array filter (today's sales count + revenue + top items).
  - `listPOSProducts` asserts before joining stock balances.
  - `createSale` asserts after the tier check (tier error wins if both apply).
  - `getSale` + `voidSale` fold the scope into WHERE for 404-via-scope behavior.
  - `listSales` — explicit branchId asserts; otherwise scopes the where clause.
  - `getPOSReport` + `getDailyZReport` — same pattern (and the inner subqueries that join through `s2` get a parallel `branchClauseS2`).
  - `getPOSBranchHours` + `updateBranchReceipt` — assert before reading/writing per-branch state.

  **Inventory** (`apps/web/src/server/functions/inventory.ts` + `inventory-po.ts`):

  - `listInventoryItems` balance-sum gains the branch filter (cashiers no longer see "100 units across all branches" they can't touch).
  - `recordMovement` + `deleteMovement` — write gating + 404-via-scope.
  - `listInventoryMovements` — explicit filter asserts; otherwise scoped.
  - `listInventoryBranches` — filter the returned set.
  - `createPurchaseOrder`, `listPurchaseOrders`, `getPurchaseOrder`, `sendPurchaseOrder`, `cancelPurchaseOrder`, `receivePurchaseOrder` — all gated.

  **Cashier UI** (`apps/web/src/routes/_authed/pos/cashier.tsx`):

  - New empty-state branch when `branchAccessRestricted && branches.length === 0`: "Anda belum punya akses ke cabang manapun. Hubungi pemilik..." (vs. the existing "Belum ada cabang. Tambahkan dari Data Master.").

  **Out of scope**:

  - Attendance is already scoped via `staff_profiles.branchId` (per JUR-113 research) — no changes needed.
  - Per-permission branch scoping (e.g. "supervisor can read but not transact on branch X") still requires the RBAC overhaul; this PR is access-or-no-access only.

- a2f8a1f: JUR-135 PR 1 — `tenant_member_branches` junction + Owner UI (no enforcement yet):

  Lays the foundation for per-member branch scoping. Owners can pin members to specific branches via the invite form and the inline chip editor on `/settings/members`. **No server-side enforcement is wired up in this PR** — assignment data is stored but POS / Inventory still see all branches for everyone. The enforcement layer ships in PR 2 (JUR-135 part 2) so any UI bugs here can't break production cashiers.

  **Schema**

  - New `tenant_member_branches (id, tenant_member_id, branch_id, created_at)` junction with `UNIQUE (tenant_member_id, branch_id)` + read indexes on both FKs. Lives in its own file to avoid the circular import between `auth.ts` (needs `branches`) and `attendance.ts` (already imports `tenantMembers`).
  - Migration `0054_tenant_member_branches.sql`.
  - Empty rows for a member = unrestricted ("all branches") — backward-compatible with every existing tenant on deploy.

  **Auth**

  - `AuthContext.allowedBranchIds: string[] | null` — null when unrestricted (owner role, impersonation, or empty junction), `string[]` when explicitly pinned. `requireAuth` reads the junction in one extra query per authenticated request (skipped for owners).

  **Server fns** (`apps/web/src/server/functions/tenant-members.ts`)

  - `listTenantMembers` now returns `assignedBranchIds` per row (one batched query, grouped in JS).
  - `listTenantBranchesForMembers` — light list for the picker (active branches, main first).
  - `inviteTenantMember` accepts a `branches` discriminated union (`{mode:'all'} | {mode:'specific', branchIds[]}`), validates the IDs belong to the tenant, inserts junction rows (skips for owner role).
  - `setTenantMemberBranches` — replaces a member's pins in a single transaction. Refuses to mutate owner rows.
  - `updateTenantMemberRole` — promoting to owner clears any existing pins so a future demote doesn't silently re-apply out-of-date scoping.

  **UI** (`/settings/members`)

  - New "Cabang" column on the table (hidden when tenant has ≤1 branch).
  - Owner row → locked "Semua cabang" badge.
  - Other rows → editable chip ("Cabang BSD ✎" / "3 cabang ✎" / "Semua cabang ✎") opening an inline popover with the same access picker the invite form uses.
  - Invite form has a new "Akses Cabang" section: radio (Semua / Cabang tertentu) + checkbox list with main-branch flag. Defaults to "Cabang tertentu" pre-selecting the main branch (per the agreed-upon restrictive default).
  - Zod refine + client-side check enforce ≥1 branch OR "Semua cabang" — no member can end up with zero access.
  - All new strings localised in id/en.

- a2f8a1f: Migrate public routes to i18n (JUR-138):

  - Auth flow (login, register, forgot-password, reset-password, OAuth callback)
  - Help center (index + article view)
  - Comparison page (`/vs-qasir`)
  - Legal docs (Privacy Policy, Terms of Service)

  All visible JSX strings, form validation errors, and `head()` meta tags now flow through `react-i18next`. Indonesian copy remains the source of truth; English translations follow these rules: Kasir → Cashier, Kelola → Configure, HPP → Cost of Goods Sold. Long-form legal docs were migrated mechanically — English copy in `privacy.tsx` / `terms.tsx` should get a legal/native-speaker review before being marketed externally.

- a2f8a1f: JUR-14: Migrate HPP unit text columns to `master_hpp_units` FK.

  Tech-debt cleanup follow-up to JUR-10. `materials.unit` and `product_materials.unit` were free-text columns; every value across all tenants happened to match a `master_hpp_units.value` (verified pre-migration), but the link was brittle — typos / drift could break unit conversion silently.

  **Schema** (`0028_hpp_unit_fk.sql`):

  - Added `unit_id uuid REFERENCES master_hpp_units(id)` (nullable) to both tables
  - Backfilled from text via `master_hpp_units WHERE value = lower(trim(unit))` (28 rows)
  - DO block raises if any backfill is incomplete (catches rare drift between data check and migration apply)
  - Dropped legacy `unit text` columns
  - Marked `unit_id NOT NULL`

  **Server** (hpp.ts + inventory.ts):

  - All reads of `materials.unit` / `product_materials.unit` now join `master_hpp_units` to get the value/label (aliased twice in queries that read both tables' units, e.g. `getProductMaterials` / `calculateProductHpp`)
  - `assertHppUnitMatchesBase` switched from text equality to FK equality — no string normalisation needed
  - `createMaterial` returns `unit` + `unitLabel` from the master row so callers can write the unit back to form state without an extra round-trip
  - `addProductSubProduct` input changed from `unit` to `unitId`

  **JUR-10 deduction simplified** (pos.ts):

  - The runtime "WHERE value = lower(unit)" lookup is gone — `productMaterials.unitId` is read directly from the BOM query, joined with `master_hpp_units` for the error-message label
  - Recipe unit comparison against ingredient `baseUnitId` is now FK ⇄ FK
  - Same hard-error behaviour on unit mismatch (Q1 contract preserved)

  **Validators** (`packages/shared/src/validators/hpp.ts`):

  - `createMaterialSchema.unit` (text) → `unitId` (uuid)
  - `createProductMaterialSchema.unit` (text) → `unitId` (uuid)

  **Master data API**:

  - `getHppUnits` now returns `id` alongside `value` + `label` so HPP forms can persist `unitId` (FK) without a second round-trip

  **Forms** (`hpp/calculate.tsx`, `hpp/products.tsx`, `master/suppliers.tsx`):

  - Form fields keep storing `unit` as text (cashier mental model: "gram", "ml")
  - Submit-time translation via a `unitIdByValue` Map built from the master units cache
  - `resolveUnitId` callback threaded into `StepKomponenBiaya` for the auto-create-material path
  - Server returns the unit text (via join) so post-save form state stays consistent

  **Data check verified post-migration**:

  - `materials`: 15 rows, 0 nulls
  - `product_materials`: 13 rows, 0 nulls

- a2f8a1f: Migrate remaining admin routes to i18n (JUR-140):

  - `admin/index` — platform overview dashboard
  - `admin/monitoring` — server metrics (RAM/CPU/disk/S3)
  - `admin/wa-plans` — WhatsApp AI subscription plan CRUD
  - `admin/rag-tools` — RAG tool registry + retrieval preview
  - `admin/referrals.config` — global referral cap/window/clawback
  - `admin/referrals.claims` — payout queue management

  Closes the admin-side i18n migration. All admin pages now flow visible strings, form labels, toasts, confirm dialogs, and aria-labels through `react-i18next`. EN copy is admin-internal — quality bar is functional, not marketing.

- a2f8a1f: JUR-141 Peti Kas — fix two regressions caught during local QA before deploy:

  **Client-bundle leak ("Buffer is not defined")**
  The shared helpers (`insertCashMovement`, `findOpenSession`, `CASH_DRAWER_OPEN_FIRST`) were exported as plain functions/constants from `apps/web/src/server/functions/pos-cash.ts`. The TanStack Start macro only strips `createServerFn().handler(...)` bodies from the client bundle — non-createServerFn exports stay and transitively pull in `db` → `postgres` → Node Buffer, crashing `/pos/cashier` + `/pos/cash-sessions` in the browser. Moved the helpers into a new server-only `apps/web/src/server/lib/cash-movement.ts` so routes never import them.

  **`insertCashMovement` silently dropped the running-total update**
  `tx.update(posCashSessions).set({ [direction]: sql.raw(...) })` used the SQL column name (`'cash_in_total'`) as the key. Drizzle's `.set()` expects the schema property name (`cashInTotal`) and silently ignored the unknown key, so the ledger row was inserted but `cash_in_total` / `cash_out_total` never incremented — the cashier chip showed stale balances after every sale/setor/tarik. Split into explicit sale vs non-sale branches using `posCashSessions.cashInTotal` / `.cashOutTotal` column refs.

  **Hooks-order violation in `/pos/cashier`**
  Banner-dismiss `useState` + `useEffect` were declared after the `if (masters.isLoading) return ...` early returns. React detected hook count changes between renders and force-crashed the component. Moved the hooks up to live with the rest of the state declarations.

  No DB migration. No schema change. All three bugs would have shipped to prod if we hadn't run the local end-to-end test.

- a2f8a1f: JUR-141 / JUR-142 PR 1 — Peti Kas schema + server fns (data layer only, zero UX impact):

  **Schema**

  - New `pos_cash_sessions` table — one row per cashier open/close cycle. Partial unique index `(branch_id, cashier_user_id) WHERE status = 'open'` enforces at most one open session per cashier at the DB level.
  - New `pos_cash_movements` table — ledger of every cash event in a session (sale, refund, drop, payout). CHECK constraints enforce `reason` required for drop/payout and `reference_sale_id` required for sale/refund.
  - Adds `pos_settings.cash_drawer_enabled` (boolean) — **defaults to `false`** so PR 1 ships safely (a `true` default would break cash sales for every existing tenant before the PR 2 UI lets them open sessions). PR 4 will flip to `true` for Komplit tenants in a one-time UPDATE and change the column default to `true` for new onboarding.
  - Adds `pos_settings.cash_variance_threshold` (numeric, default Rp 10.000).
  - Migration `0055_pos_cash_drawer.sql` (idempotent CREATEs + ALTERs).

  **Server fns** (`apps/web/src/server/functions/pos-cash.ts`)

  - `getCurrentOpenSession({ branchId })` — UI mount-time check. Returns `{ disabled: true }` for tenants who toggled off, `{ session: null }` when no open session, or the session with derived `runningBalance` + `isStale` flag.
  - `openCashSession({ branchId, openingBalance, openingNotes? })` — INSERT with friendly Indonesian translation of the 23505 unique-violation when a session is already open.
  - `closeCashSession({ sessionId, actualClosing, closingNotes?, forceClosed? })` — recomputes `expected_closing` from the ledger as a sanity check vs the rolling totals, writes variance, flips status.
  - `recordCashDrop` / `recordCashPayout` — symmetric `{ sessionId, amount, reason }` validators.
  - `listCashSessions(...)` — owner reporting list, branch-scoped via JUR-135.
  - `getCashSessionDetail({ sessionId })` — session header + full movement ledger (newest first) for the detail drawer.

  **createSale + voidSale wiring** (`apps/web/src/server/functions/pos.ts`)

  - Cash sales resolve the open session BEFORE the transaction starts. No open session + drawer enabled ⇒ throws `'Buka Kas dulu sebelum jualan tunai.'` (literal — PR 2 UI matches on it).
  - On a successful cash sale, an atomic `pos_cash_movements` row of `type='sale'` is INSERTED in the same `db.transaction`, with `amount = effectiveTotal` (NET cash change in the till — paid minus change-back).
  - Voiding a cash sale resolves the CURRENT open session for (branch, void-caller) and INSERTs `type='refund'` movement linked back to `pos_sales.id`. Prior-session sales hit today's open session — matches the agreed JUR-141 design.
  - `getPOSCashierMasters` returns a new `cashDrawer: { enabled, varianceThreshold }` block so PR 2's cashier UI doesn't need a second round-trip.

  **Backward-compat**

  - Default `cash_drawer_enabled = false` means PR 1 has zero behavioral impact for any existing tenant. Cash sales work exactly as before because the gate short-circuits when disabled.

- a2f8a1f: JUR-141 / JUR-143 PR 2 — Peti Kas cashier UI:

  Five new components under `apps/web/src/components/pos/cash/`:

  - **`<BukaKasModal>`** — blocking dialog when no open session exists. CurrencyInput for opening balance + optional notes textarea. No "Batal" button on purpose (alternative is signing out).
  - **`<KasHeaderChip>`** — pill in the `/pos/cashier` header showing live running balance (`opening + cash_in − cash_out`). Click opens a ⋮ menu with Setor Tunai / Tarik Tunai / Tutup Kas. Outside-click dismiss.
  - **`<SetorTarikModal>`** — symmetric drop/payout entry. Same shape (amount + reason); `kind` prop picks the title/CTA strings and which server fn (`recordCashDrop` vs `recordCashPayout`).
  - **`<TutupKasModal>`** — close-out reconciliation. Loads `getCashSessionDetail` to compute the rekap live (so it picks up movements made in concurrent tabs). Live variance preview as the cashier types the physical count. When `|variance| ≥ varianceThreshold`, the row turns red, an `AlertTriangle` shows, and the closing-notes field becomes required.
  - **`<StaleSessionModal>`** — blocking modal when `getCurrentOpenSession` returns a session opened >14h ago. Single "Force Close & Start New Session" CTA records variance with `force_closed=true` and an auto-generated note.

  `/pos/cashier` wiring:

  - New `cashSessionQuery` polls every 30s when the drawer is enabled.
  - Header conditionally renders `<KasHeaderChip>` when a session is open and drawer is enabled.
  - `<BukaKasModal>` renders over the page when drawer is enabled AND no session exists.
  - `<StaleSessionModal>` wins when there's an open session opened more than 14h ago.
  - `createSale.onError` matches the literal `'Buka Kas dulu sebelum jualan tunai.'` from PR 1 and fires a toast + refetches the session — defensive race-safety in case the cashier's local state lagged.
  - `varianceThreshold` and `cashDrawer.enabled` flow from the existing `getPOSCashierMasters.cashDrawer` block added in PR 1.

  i18n: new `pos.cash` namespace with id + en strings for every visible bit of copy, following the JUR-138 glossary (Kasir → Cashier, etc).

  **Backward-compat**: nothing renders for tenants with `cash_drawer_enabled = false` (the safe default from PR 1). Existing cashier UX is unchanged until PR 4 flips the flag on for Komplit tenants.

- a2f8a1f: JUR-141 / JUR-144 PR 3 — Peti Kas owner reporting + Z-report data hook:

  **New route** `/pos/cash-sessions` (under POS Kasir nav)

  - Filters: from / to (defaults to current month) / branch (auto-scoped via JUR-135) / status (open/closed/all) / "ada selisih saja" checkbox.
  - Table columns: Tanggal, Cabang, Kasir, Modal, Ekspektasi, Fisik, Selisih, Status.
  - Variance highlight: `|variance| ≥ tenant's cash_variance_threshold` → red bold + `AlertTriangle`. Below threshold → muted gray.
  - Status pills: open (emerald), closed (gray), force_closed (amber + lock icon).
  - Row click opens a side `<Sheet>` with full detail: rekap (opening + cash_in − cash_out = expected vs actual + variance), opening/closing notes, full movement ledger with type badges (sale/refund/drop/payout) and per-row signed amounts.
  - CSV export — minimal client-side blob; PR 4 (JUR-145) will finalise the column shape per the ticket spec.

  **Permissions**

  - New `MODULE_NAV` entry under POS Kasir gated by `permission: 'pos.read'`.
  - `listCashSessions` + `getCashSessionDetail` server fns now auto-restrict cashiers (no `pos.manage` permission) to their own sessions only. Supervisors + owners see everything.

  **Z-report data hook**

  - `getDailyZReport` server fn (in `apps/web/src/server/functions/pos.ts`) now returns a `cashReconciliation: { sessions[], totalVariance }` block: per-session variance for the day + the day's net variance total. Closed + force-closed sessions counted differently — force-closed excluded from `totalVariance` because their physical count wasn't real.
  - No UI consumer exists yet for the JSON Z-report (only the PDF generator, which has its own SQL path). PR 4 will extend the PDF + any future on-screen Z-report to render the new block.

  **i18n**

  - New keys under `pos.cashSessions` (id + en) — list page columns, filters, detail drawer labels, movement type badges. Follows JUR-138 glossary.

  **Backward-compat**

  - Page renders for any tenant with `pos.read`. Empty state when there are no sessions yet — true for everyone today because `cash_drawer_enabled` is still `false` from PR 1.

- a2f8a1f: JUR-141 / JUR-145 PR 4 — Peti Kas polish (final piece of the feature):

  **Migration `0056_pos_cash_drawer_default_komplit.sql`**

  - Backfills `cash_drawer_enabled = true` for every existing Komplit tenant.
  - Flips the column default to `true` so future Komplit onboarding starts opted-in.
  - Free + legacy tier rows stay `false` (their UI never surfaces the feature).

  **Tier gating (Komplit-only)**

  - `getPOSCashierMasters.cashDrawer.enabled` is now `posTier === 'komplit' && settings.cashDrawerEnabled`. Free / legacy tenants always get `false`, so PR 2 cashier UI never mounts the BukaKasModal.
  - `createSale` + `voidSale` skip the open-session check entirely for non-Komplit tenants.
  - `getCurrentOpenSession` returns `{ disabled: true }` for non-Komplit (UI no-op).
  - `openCashSession` defensively refuses with "Peti Kas hanya tersedia di paket Komplit." for non-Komplit callers (curl-safety).

  **Settings UI** (`/pos/settings`)

  - New "Peti Kas" section, rendered only when `data.tier === 'komplit'`.
  - Toggle for `cash_drawer_enabled` + `Rp` input for `cash_variance_threshold` (Rp 10.000 default).
  - Has its own Save button so toggling Peti Kas doesn't get accidentally batched with tax/payment-method edits.
  - New server fn `updatePOSCashSettings` — Komplit-only, persists via upsert on `pos_settings`.

  **Pricing page** (`/pricing` comparison table — POS section)

  - 3 new rows under "Sistem Kasir POS":
    - Peti Kas (buka/tutup shift kasir) — ✗ Free / ✓ Komplit / ✓ Enterprise
    - Setor Tunai / Tarik Tunai (paid out)
    - Variance & rekonsiliasi harian
  - New i18n keys in both id + en.

  **vs-qasir page**

  - New parity row "Peti Kas (buka/tutup + variance)" — ✓ Komplit / ✓ Qasir Pro. Explicit so the table doesn't accidentally imply we're missing this standard POS feature.

  **Onboarding banner** (`/pos/cashier`)

  - Dismissible "🆕 Fitur Baru: Peti Kas" callout. localStorage flag (`jq_peti_kas_banner_dismissed`) so each cashier sees it exactly once.
  - Hidden when the drawer is disabled (free tier, kill-switch off) so we don't tease a feature they can't use.

  **Acceptance status**

  - ✅ `/pricing` shows 3 new rows under POS, ✓ Komplit / ✗ Free
  - ✅ `/vs-qasir` lists Peti Kas as parity
  - ✅ `/pos/settings` shows section for Komplit; saving persists; flipping OFF removes the BukaKasModal blocker on next cashier load
  - ✅ Onboarding banner appears once + dismisses
  - ✅ Every new string has id + en value
  - ⏭ **Deferred** to follow-up: rich CSV column breakdown (Penjualan/Refund/Setor/Tarik per row) — current export uses summary totals; needs movement-type aggregates added to `listCashSessions`
  - ⏭ **Deferred** to follow-up: PDF Z-report "Rekonsiliasi Kas" section — `getDailyZReport` JSON already returns the data block, but the PDF generator (`getDailyZReportPDF`) has its own SQL path that needs the same extension

- a2f8a1f: JUR-146 Feedback Phase 1 — tenant-side feedback inbox.

  **Schema.** New `feedback_threads` + `feedback_messages` tables in `packages/db/src/schema/feedback.ts`. A thread carries the tenant scope, subject, status (`open` / `replied` / `resolved`), and an optional `public_email` / `public_name` pair so the same tables can later host non-authenticated submissions. Messages carry `sender_type` (`tenant` / `admin` / `public`), the body, and the sender user id when known.

  **Server fns.** `createFeedbackThread`, `addFeedbackMessage`, `listFeedbackThreads`, `getFeedbackThread` — all gated by `requireAuth` and scoped to the caller's tenant. `getFeedbackThread` joins the messages chronologically so the detail route can render a thread in a single round-trip.

  **Routes.** `/help/feedback` lists the tenant's threads with status pills + last-activity timestamps; an inline "Kirim Feedback" sheet form opens a new thread. `/help/feedback/$threadId` renders the conversation with a reply composer at the bottom.

  **Sidebar.** New "Bantuan" section with a "Kirim Feedback" entry so the inbox is reachable from every authed page.

  Phase 2 (admin side) and Phase 4 (notifications + email fallback) follow in JUR-147 / JUR-149.

- a2f8a1f: JUR-147 Feedback Phase 2 — platform-admin inbox + reply.

  **Admin server fns.** `listAdminFeedbackThreads`, `getAdminFeedbackThread`, `replyAsAdmin`, `setFeedbackStatus` in `apps/web/src/server/functions/admin-feedback.ts`. Every fn is gated by `requirePlatformAdmin` so tenant accounts can never reach cross-tenant threads. `listAdminFeedbackThreads` supports filtering by status (`open` / `replied` / `resolved` / `all`), source (`in_app` / `public`), and a substring search across subject + body — needed so the inbox stays usable once volume grows.

  **Route.** `/admin/feedback` renders the filter bar + thread list with status pills, and opens the selected thread in a sheet with the full message history, a reply composer (writes a message with `sender_type='admin'`), and a status select for marking threads resolved.

  **Admin sidebar.** New "Feedback" entry under the Modules section.

  Notifications (admins-on-new-thread, tenant-on-reply, 24h email fallback) follow in JUR-149.

- a2f8a1f: JUR-148 Feedback Phase 3 — public /contact page + Brevo email reply path.

  **Public route.** New unauthenticated `/contact` (`apps/web/src/routes/contact.tsx`) using the same landing layout as `/pricing` and `/vs-qasir`. Form fields: name, email, subject, body (RHF + Zod, full Indonesian/English i18n under the new `contact.*` namespace). On success the form swaps to a confirmation screen with CTAs back to `/` and `/pricing`. Discoverable via a new "Kontak" entry in the landing navbar and a "Hubungi Kami" link in the footer's Dukungan section.

  **Server fn.** `submitPublicFeedback` in `apps/web/src/server/functions/feedback.ts` — unauthenticated. Writes a `source='public'` thread with `tenant_id=null`, the submitter's name + email, and the client IP. Inserts the first message with `sender_type='public'` and dispatches `notifyAdminsOfNewFeedback` so every platform admin sees the new thread in their notification bell.

  **Spam defenses (defense in depth, no single point of failure):**

  1. **Honeypot field.** Hidden `website` input (absolutely-positioned off-screen + `aria-hidden` + `tabIndex={-1}` + `autocomplete=off`). Filled by every bot that brute-force-fills inputs; real users skip it. Server silently 200s when filled so the bot can't tune its next attempt.
  2. **Cloudflare Turnstile.** Loaded explicitly via `?render=explicit` so it doesn't fight React hydration. Site key (`VITE_TURNSTILE_SITE_KEY`) gates client widget rendering; secret (`TURNSTILE_SECRET_KEY`) gates server-side verification at `challenges.cloudflare.com/turnstile/v0/siteverify`. Both vars empty = captcha disabled (local dev works without a Cloudflare account), and the form still ships honeypot + rate limit + email validation.
  3. **Per-IP rate limit.** 5 submissions per rolling hour, keyed off `x-forwarded-for` (first hop) or `x-real-ip`. Counts via a single indexed query against `feedback_threads.submitter_ip` — no in-memory state to lose on PM2 restart, multi-instance safe.
  4. **Zod validation.** Trim + length caps on every field, email format, 10-character minimum body to deter one-word spam.

  **Schema.** Migration `0059_feedback_submitter_ip.sql` (idempotent — `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) adds:

  - `feedback_threads.submitter_ip text` — nullable, populated only for `source='public'` rows.
  - `feedback_threads_submitter_ip_created_idx (submitter_ip, created_at)` — supports the rate-limit count query without a sequential scan.

  Applied to prod (`feedback_submitter_ip`).

  **Admin reply path.** `replyAsAdmin` in `apps/web/src/server/functions/admin-feedback.ts` now branches on `thread.source`:

  - `public`: fetches the first message (= the original contact form body), renders `buildContactReplyEmail({ name, originalSubject, originalBody, replyBody, contactUrl })`, and sends via Brevo to `public_email` with tag `contact_admin_reply`. Email failures are logged but never roll back the message insert + status flip — the admin's reply is the source of truth, so a Brevo glitch can't undo it; admin can re-click "Kirim Balasan" to retry the send.
  - `in_app`: existing tenant in-app notification path, unchanged.

  **Email template.** `buildContactReplyEmail` in `apps/web/src/server/email.ts`. Subject is prefixed `Re: {originalSubject}` so the recipient's mail client threads it. Reply body capped at 8000 chars, original quoted underneath capped at 2000. CTA points back to `/contact` (no inbound email parsing in v1 — spec defers 2-way threading to v2). Footer line explicitly tells the user "balasan email ini tidak terbaca" so nobody expects the reply-to to work.

  **Admin inbox extensions.** `getAdminFeedbackThread` now returns `publicEmail` + `publicName`. The detail sheet:

  - Shows a `<Globe2/> Publik` badge in the thread list for public threads.
  - Renders the submitter as `Name <email@x.com>` (clickable `mailto:`) in the detail header instead of just "Publik".
  - Above the composer for public threads, surfaces "Balasan akan dikirim ke `<email>` via email" so the admin knows they're triggering a Brevo send, not an in-app notification.
  - Composer placeholder swaps to "Tulis balasan email..." for public threads.

  **Env vars.** `apps/web/.env.example` documents `VITE_TURNSTILE_SITE_KEY` (public, browser-exposed) + `TURNSTILE_SECRET_KEY` (server only) with the "both empty = disabled" behavior called out explicitly so a dev pulling fresh doesn't think the form is broken.

  **Out of scope (deferred per ticket):** 2-way email threading, inbound email parsing, Phase 4 notifications (already shipped in JUR-149).

  **Acceptance criteria verified:**

  - Anonymous user submits `/contact` form → sees confirmation screen → thread appears in admin inbox tagged `Publik`.
  - Admin reply sends a real Brevo email to `public_email` with `Re: {subject}` subject + quoted original.
  - 6th submission within an hour from the same IP throws "Terlalu banyak pesan dari alamat ini. Coba lagi dalam 1 jam." instead of writing a new thread.
  - Honeypot fill returns success without writing to the DB.

- a2f8a1f: JUR-149 Feedback Phase 4 — in-app notifications + 24h email fallback.

  **Schema.** Migration `0058_feedback_support_notifications.sql` adds two nullable columns (idempotent `ADD COLUMN IF NOT EXISTS`, safe to re-apply on environments that never ran the Phase 1 migration):

  - `feedback_threads.tenant_last_viewed_at` — stamped to `now()` every time the tenant opens the thread detail, used to suppress the email fallback once the tenant has actually seen the reply.
  - `feedback_messages.email_sent_at` — sticky marker so the daily scheduler tick never re-sends a fallback email for the same admin reply.

  **In-app notifications.** New module `apps/web/src/server/feedback-notifications.ts`:

  - `notifyAdminsOfNewFeedback` fires when a tenant opens a thread (`kind='new_thread'`) or replies into an existing one (`kind='tenant_reply'`); fans out one notification to every row in `platform_admins` with a `/admin/feedback` deep link.
  - `notifyTenantOfAdminFeedbackReply` fires when admin replies; notifies the tenant owner plus every tenant member who has previously posted in the thread, with a `/help/feedback/$threadId` deep link.
  - `sendDueFeedbackReplyEmails` is the daily-scheduler job. Picks unread admin replies older than 24h (`tenant_last_viewed_at IS NULL OR < admin reply time`), looks up the tenant owner email via Supabase admin, and sends via the existing Brevo helper — then stamps `email_sent_at` so the next tick skips it.

  All three helpers are wrapped in `try/catch` so a notification failure can never reject the underlying feedback write.

  **Shared constants.** Three new entries in `NOTIFICATION_TYPES`: `feedbackNewThread`, `feedbackTenantReply`, `feedbackAdminReply` — picked up by the existing `NotificationBell` rendering pipeline.

  **Email template.** `buildFeedbackReplyEmail` in `apps/web/src/server/email.ts` renders the Indonesian fallback: subject + 600-char preview of the admin reply + CTA back to the thread, with a footer line explaining why the email was sent (so tenants don't think we're spamming them).

  **Scheduler.** `apps/web/src/server/scheduler.ts` daily tick now calls `sendDueFeedbackReplyEmails` after the existing jobs.

  **Server fn wiring.** `createFeedbackThread` / `addFeedbackMessage` / `replyAsAdmin` all dispatch the appropriate notification helper after the DB write succeeds. `getFeedbackThread` stamps `tenant_last_viewed_at = now()` on every open so the email fallback is suppressed the moment the tenant sees the reply.

  **Route split.** `/help/feedback` is now a layout route (`Outlet`) and the inbox UI moved into a child index file `help.feedback.index.tsx`. The new-thread UI moved from a `Sheet` into a centered `Dialog` so it doesn't fight the thread-list scrollbar on mobile.

  **Dialog component.** New `placement="center"` prop on `Dialog` — keeps the existing mobile bottom-sheet behavior as default, but lets the centered variant skip the drag handle and use a single centered card across both breakpoints. Used by the new feedback dialog.

  **Admin layout.** `NotificationBell` added to `/admin/*` so platform admins actually see the new admin-side notifications.

  **Sidebar housekeeping.** `Bantuan` / `Kirim Feedback` labels migrated to i18n keys (`nav.sectionHelp`, `nav.feedback`). Removes an accidentally duplicated `navFeedback` entry in `admin-sidebar.tsx`.

  Migration applied to prod (`feedback_support_notifications`). Typecheck green.

- a2f8a1f: JUR-15 step 1: schema + migration for batch-prep mode on recipe-backed
  POS items.

  - New `prep_mode` boolean on `inventory_items` (default false).
  - CHECK constraint enforces `prep_mode=true` requires a recipe link.
  - New table `inventory_item_prep_batches` with `qty_prepared` /
    `qty_consumed` columns for FIFO consume + an open-rows partial index
    so consume scans stay small as history grows.

  No behavior change yet — server fns and UI wire-up land in follow-up commits.

- a2f8a1f: JUR-15 step 2: extract BOM-deduct helper from pos.ts into a shared
  module (`apps/web/src/server/lib/bom-deduct.ts`). Refactor only — no
  behavior change. The helper is now parameterized over `reason`,
  `referenceType`, `referenceId`, and `notesPrefix` so JUR-15's prep-batch
  flow can reuse the exact same BOM walk + stock movement insert that POS
  sales use today.
- a2f8a1f: JUR-15 step 3: prep-batch server functions
  (`apps/web/src/server/functions/pos-prep.ts`).

  - `recordPrepBatch`: gated by inventory.write + ingredient_consumption
    tier feature. Runs the shared BOM walk with reason='prep_batch',
    inserts an open ledger row in `inventory_item_prep_batches`.
  - `getPrepStatus`: returns the current "Siap" sum for a (item, branch)
    pair, computed from open ledger rows only.
  - `listPrepBatches`: history feed for inventory detail + waste report.

  UI wiring lands in step 5 and 6.

- a2f8a1f: JUR-15 step 4: branch the POS sale path on `inventoryItems.prepMode`.

  When a recipe-backed line has `prep_mode=true`, the sale skips BOM
  ingredient deduction (which already happened at prep time) and instead
  FIFO-consumes open ledger rows in `inventory_item_prep_batches` under
  `FOR UPDATE`. Insufficient prep stock throws and rolls back the whole
  sale — matches the "hard block at Siap=0" UX decision.

  Non-prep recipe-backed sales are unchanged (same BOM walk via the
  helper extracted in step 2). Free-tier behavior unchanged (no
  ingredient deduction either way).

- a2f8a1f: JUR-15 step 5: cashier UI for prep-mode items.

  - `listPOSProducts` now returns `prepMode` + `siapInBase` (aggregated
    across open prep batches at the active branch).
  - Cashier tile renders `Siap: N` instead of `Auto` for prep-mode items,
    and hard-disables when `siapInBase = 0` ("Habis prep" badge).
  - New shared `PrepBatchSheet` component (used here + in step 6) — qty
    input, optional notes, recent-prep tail, invalidates `pos/products`
    cache on success so the Siap counter refreshes.
  - Corner `+` action on prep-mode tiles opens the sheet. Hidden for
    callers without `inventory.write`.

- a2f8a1f: JUR-15 step 6: inventory item form toggle + prep panel.

  - `PrepModeToggle` component on the item edit Sheet, visible only when
    the recipe link is on. Persisted via `updateInventoryItem` (which
    silently clears prep_mode if the recipe link is removed in the same
    edit, sidestepping the DB CHECK).
  - New `PrepBatchPanel` on the item detail page for prep-mode items —
    shows current Siap counter per branch + "Prep batch" CTA that opens
    the shared sheet. Tells the operator clearly when stock is empty
    so the cashier rejection makes sense.

- a2f8a1f: JUR-15 step 7 (final): prep waste / leftover report at
  `/pos/reports/prep-waste`.

  - New `getPrepWasteReport` server fn aggregates batches by
    (day × item × branch) with SUM(prepared / consumed / leftover) in
    Postgres so any date range works without paging.
  - Tier-gated behind `pl_report` (matches main reports page).
  - Header stats: total prepared / consumed / leftover + overall waste
    pct. Per-row badge when `leftover / prepared >= 20%` so the owner
    can spot consistent over-prep at a glance.
  - Sidebar entry "Laporan Prep & Sisa" under POS Kasir.

  Closes JUR-15.

- a2f8a1f: JUR-15 post-test fix: the prep-batch sheet was only invalidating
  `['prep-batches', ...]` after a successful record, but the inventory
  page's `PrepBatchPanel` reads from `['prep-status', ...]` — different
  key prefix — so its inline "Siap dijual" counter stayed at 0 until a
  manual refresh. Found via Playwright smoke test on Mantra Maker.

  Invalidating both prefixes plus `['pos', 'products']` now so every
  Siap surface refreshes the moment a prep batch lands.

- a2f8a1f: JUR-15 route fix: rename `pos/reports.tsx` → `pos/reports.index.tsx`
  so `/pos/reports/prep-waste` no longer falls through to the P&L
  report. The flat-file routing made the prep-waste page a child of
  the leaf `reports.tsx` (no Outlet), so visiting the URL silently
  rendered the parent. With `.index.tsx`, both routes are siblings
  and resolve independently.
- a2f8a1f: JUR-167 — Queue mode for cuci motor / IGD klinik tenants.

  **Why now.** A cuci motor client is waiting on this — they need a FIFO queue UI to run their day. Slot-mode bookings (Phase 1) don't fit: walk-ins, no reservation times, "first come first served" with an in-progress ticket per bay.

  **Schema (migration 0064, applied to prod):**

  ```sql
  ALTER TABLE bookings ADD COLUMN ticket_number text;             -- "#12" etc., null for slot mode
  ALTER TABLE booking_resources ADD COLUMN is_paused boolean NOT NULL DEFAULT false;
  CREATE INDEX bookings_resource_status_created_idx ON bookings (resource_id, status, created_at);
  ```

  Both additive — slot-mode tenants unaffected. The new index supports the "fetch this resource's queue in arrival order" query that the QueueView fires on every render.

  **Server fns (`apps/web/src/server/functions/booking.ts`):**

  - `createQueueTicket({ branchId?, customerId?, publicName?, publicPhone?, resourceId?, serviceIds, note?, source })` — when `resourceId` is omitted, auto-routes to the resource with the shortest pending+in_progress queue (paused resources are skipped; falls back to first active if everything paused). Assigns a `ticket_number` via a per-tenant per-day sequence (`COALESCE(MAX(SUBSTRING(...) AS int), 0) + 1`, format `"#N"`). Sets `mode='queue'`, `status='confirmed'`, `startAt=now()`. Skips the slot-mode conflict check (queue mode doesn't overlap by time).
  - `startQueueTicket({ id })` — pending/confirmed → in_progress. Guards via status condition so re-firing doesn't double-promote.
  - `completeQueueTicket({ id })` — active → completed + stamps `endAt=now()` (for downstream wait-time analytics).
  - `cancelQueueTicket({ id })` — active → cancelled. Guards against re-cancelling completed tickets.
  - `toggleResourcePause({ id, isPaused })` — flips `booking_resources.is_paused`. The auto-router checks this on every `createQueueTicket` call.
  - `getQueueSnapshot()` — returns all `pending / confirmed / in_progress` bookings for the tenant, ordered by `created_at ASC`. UI groups by `resourceId` client-side. Polled every 15s in the QueueView (server-side WebSocket push deferred to a later ticket).

  **Drizzle schema.** `bookingResources.isPaused` (boolean default false), `bookings.ticketNumber` (text nullable), new `bookings_resource_status_created_idx` index.

  **UI (`apps/web/src/routes/_authed/booking/queue.tsx` — new file).**

  The QueueView replaces the day/week/month calendar entirely when `settings.mode='queue'`. Top-level layout: per-resource columns in a responsive grid (2 cols on sm, 3 on lg, 4 on xl). Each column has:

  - **Header** with resource name, `{count} dalam antrian` chip, "Pause" / "Unpause" toggle button. Paused resources get an amber border + "Pause" badge.
  - **In-progress slot** (green strip at the top of the column) when a ticket is currently being worked on. Shows the ticket number (large monospace), customer name, "Started at HH:MM" with a clock icon, and a big "Selesai" button.
  - **Pending list** below (FIFO ordered by `created_at`). Each ticket: number + position chip + customer name. The first pending ticket gets a "Mulai" button (gated to only fire when no in-progress ticket on this resource, otherwise the operator finishes the current one first). Per-ticket × cancel button.
  - **Footer "+ Tambah ke antrian ini"** button — disabled when resource is paused.

  Top-level controls:

  - `+ Tambah Tiket` header button — opens the CreateQueueTicketSheet with `resourceId=null`, auto-routing to the shortest queue.
  - Each column's "+ Tambah ke antrian ini" — opens the same sheet but pinned to that specific resource.
  - Total active count chip ("X tiket aktif") so the operator has a glance metric for the day.

  **`CreateQueueTicketSheet`** is a slimmed CreateBookingSheet — no time picker (queue mode treats `startAt = now()`), customer search + walk-in name/phone, service multi-pick from the booking-flagged inventory items, optional note. On submit, calls `createQueueTicket` and toasts the assigned ticket number so the operator can call it verbally to the customer.

  **`/booking/index.tsx` integration.** When `settings.mode === 'queue'`, bails before the calendar scaffolding and renders the QueueView inside a minimal layout (breadcrumb + branch picker for multi-branch tenants). Day/week/month switcher, navigation arrows, and CreateBookingSheet stay reserved for slot-mode.

  **Polling.** QueueView uses `refetchInterval: 15_000` on `getQueueSnapshot`. WebSocket push is deferred to a follow-up — 15s polling is good enough for cuci motor where ticket completion takes minutes, not seconds.

  **Out of scope (explicit defer):**

  - **WA notifications** ("bersiap, giliran kamu") — needs cleaner WA infrastructure hookup; the ticket spec assumes it, but cuci motor can run without it for v1 (verbal calling works fine in a small shop).
  - **Drag-reorder for VIP priority** — rare flow. Operator can cancel + recreate to reorder if needed.
  - **Rolling 30-day wait-time estimates** — no historical data yet. v1 just shows queue length ("Antrian: 3"). Once `completed` rows accumulate, a follow-up ticket can compute avg durations.
  - **Industry template seeds** — JUR-184 already dropped templates. Tenant picks queue mode in `/booking/settings` and adds their own resources + services via the existing flows.
  - **Mode-switching guard** with active-booking confirmation — tenant locked to whatever mode they picked at setup for v1. Cross-mode switching is a v2 admin tool.

  **Acceptance checklist (smoke-testable end-to-end):**

  1. ✅ Tenant picks `Antrian` in `/booking/settings` mode picker + saves.
  2. ✅ Adds 3 resources (Bay 1, Bay 2, Bay 3) via the Anggota Tim / Staf tanpa akun flow.
  3. ✅ Marks 3 inventory items as bookable (Cuci Reguler, Premium, Salju).
  4. ✅ Visits `/booking` — sees 3 columns instead of the calendar.
  5. ✅ Clicks "+ Tambah Tiket", fills walk-in name + service → ticket appears in the shortest column with auto-assigned number (`#1`).
  6. ✅ Clicks "Mulai" on the top ticket → it moves to the green in-progress strip.
  7. ✅ Clicks "Selesai" → ticket disappears (status=completed). Next pending ticket gets its "Mulai" button enabled.
  8. ✅ Clicks pause on a column → ribbon turns amber + new tickets bypass this resource.
  9. ✅ Cancel button on a pending ticket → soft-delete via cancelled status.

  **Typecheck green. Migration applied to prod.**

- a2f8a1f: JUR-182 Booking schema refactor — unify with members + inventory + branches.

  **Why.** JUR-166 (Phase 1) shipped three tables that duplicated existing systems: `booking_resources` (vs `tenant_members`), `booking_services` (vs `inventory_items` where `is_sellable=true`), and `booking_settings.working_hours` (vs `branches.business_hours` already consumed by the WhatsApp RAG `operating_hours` retriever). `bookings` also had no `branch_id` column, so per-branch hours couldn't have been enforced anyway. Building UI on top of those would have locked in "rename Mas Budi in two places" UX forever and thrown away the entire HPP / BOM / stock-deduction / POS-integration stack for services. JUR-181 (the original Phase 1.5) was superseded once this was identified.

  **Migration 0062 (`booking_unify`, applied to prod).** Safe — `booking_*` tables had no real prod data yet.

  - `DROP TABLE booking_services CASCADE` — services live in `inventory_items` from now on.
  - `ALTER TABLE booking_settings DROP COLUMN working_hours` — hours live per-branch.
  - `ALTER TABLE inventory_items ADD is_bookable boolean NOT NULL DEFAULT false` — gates which sellable items surface in the booking service picker. Default false so existing inventory doesn't pollute the picker until tenants opt in.
  - `ALTER TABLE inventory_items ADD booking_color text` — optional hex for calendar bubbles. Mirrors the dropped `booking_services.color`.
  - `ALTER TABLE inventory_items ADD booking_duration_min integer` — how long the service takes when booked. Nullable; falls back to `booking_settings.slot_duration_min` then 30 min.
  - `ALTER TABLE booking_resources ADD member_id uuid REFERENCES tenant_members(id) ON DELETE SET NULL` — staff-kind resources can link to a real member. NULL is fine for non-staff (station, room) or for seeded "Stylist A" rows that haven't been linked yet.
  - `ALTER TABLE bookings ADD branch_id uuid REFERENCES branches(id) ON DELETE SET NULL` + index `(branch_id, start_at)`.
  - Seed `master_hpp_units ('jasa', 'Jasa / Layanan')` so the setup wizard has a unit to assign service-type inventory items to.
  - `DELETE FROM bookings / booking_resources / booking_settings` — wipe seeded test rows from JUR-166.

  **Server fns (`apps/web/src/server/functions/booking.ts`).**

  - **Dropped**: `getAllBookingServices`, `createService`, `updateService`, `deleteService` — table no longer exists.
  - **Rewired** `getBookingServices` reads `inventory_items WHERE is_sellable=true AND is_bookable=true AND is_active=true` and projects the inventory shape into the calendar's expected `{id, name, durationMin, price, color}` shape via correlated subqueries. Duration: `COALESCE(booking_duration_min, slot_duration_min, 30)`. Price: lowest-min_qty tier from `inventory_item_unit_pricing` (any unit) — v1 simplification; the full tier picker lives in POS.
  - **Added** `getBookableMembers` returns `tenant_members WHERE role IN ('owner', 'admin', 'supervisor', 'staff', 'cashier')`. v1 derives "bookable" from role; promote to a dedicated column on `tenant_members` if real-world demand surfaces.
  - **Rewrote** `completeBookingSetup`: seeds the industry-template services as `inventory_items` rows (3 inserts per service: `inventory_items` + `inventory_item_units` (default unit = 'jasa') + `inventory_item_unit_pricing` (tier-1 price)). Each row is marked `is_sellable=true AND is_bookable=true` so the new `getBookingServices` query picks them up. Seeded `booking_resources` rows keep `member_id=NULL` — admin links real members via the JUR-183 UI.
  - **Extended** `createBooking`:
    - New `branchId` input field. Resolved via `resolveBookingBranch`: explicit → as-is; null + single-branch tenant → auto-pick; null + multi-branch → throws `"Pilih cabang dulu"`.
    - New `assertWithinBranchHours` reads `branches.business_hours` shape `[{day: 0-6, open, close}]` (day 0 = Sunday, matches JS `Date.getDay()`). Throws friendly Indonesian errors when the start time falls outside the branch's hours (or the branch is closed that day). Null-gated — when `branches.business_hours` isn't configured, the check skips entirely.
    - New `assertNotBlackoutDate` reads `booking_settings.blackout_dates` (still tenant-wide; per-tenant holidays make sense for all branches).
  - **Extended** `updateResource` accepts optional `memberId` (set to a member ID to link, null to unlink, undefined leaves existing). Also made `name` optional so callers can update only `isActive` or only `memberId`.
  - **Extended** `updateBooking` accepts optional `branchId`.

  **Drizzle schema updates.**

  - `packages/db/src/schema/booking.ts`: dropped `bookingServices` export, dropped `workingHours` column, added `memberId` to `bookingResources`, added `branchId` to `bookings`, added `bookings_branch_start_idx` index.
  - `packages/db/src/schema/inventory.ts`: added `isBookable`, `bookingColor`, `bookingDurationMin` columns to `inventoryItems`.

  **Out of scope (lives in JUR-183).** All UI surfaces — `is_bookable` toggle in `/inventory/items`, member picker in `/booking/settings`, business-hours editor in `/master/branches`, branch picker in `/booking` calendar header. Also the calendar greying that reads from `branches.business_hours` instead of the (now-dropped) `booking_settings.working_hours`. And the keepers from superseded JUR-181: `+Buat Booking` button, first-run banner, empty-state, out-of-hours greying.

  **Behavior changes a user could notice today.** With JUR-182 alone (without JUR-183):

  - Tenants who set up booking from `/booking/setup` after this ships get an empty service picker — no inventory item is `is_bookable` by default. They have to manually flag items in `/inventory/items` (no UI yet — needs JUR-183). **Workaround until JUR-183 ships**: `UPDATE inventory_items SET is_bookable=true WHERE name IN ('Potong Rambut', ...)` via SQL, or re-run `/booking/setup` to seed.
  - Multi-branch tenants creating a booking without specifying `branch_id` get the `"Pilih cabang dulu"` error. The calendar create-sheet currently doesn't have a branch picker (JUR-183 adds it). Single-branch tenants are unaffected.
  - Working-hours enforcement is now real — booking outside `branches.business_hours` throws. Most branches haven't configured `business_hours` yet, so the check no-ops for them. Branches that have configured it (via the WhatsApp RAG flow or direct SQL) start enforcing.

  Typecheck green. Migration applied to prod.

- a2f8a1f: JUR-183 (2/2) — booking calendar polish: branch picker + Buat Booking button + out-of-hours greying + create-sheet branchId + HPP linkage hint.

  **Why.** JUR-182 added `bookings.branch_id` + branch-scoped working-hours enforcement server-side, but the calendar UI had no way to pick a branch (multi-branch tenants got `"Pilih cabang dulu"` errors with no surface to resolve), no way to discover the "click empty slot → create" gesture, and no visual cue for when a slot was outside business hours. This commit closes those gaps.

  **Server fn — `listBookingBranches`** (`apps/web/src/server/functions/booking.ts`):

  - Returns `{ id, name, isMain, isActive, businessHours }` for the tenant's active branches, gated on `booking.read` (so booking-only tenants without the attendance module can still read their branches — `listBranches` in attendance-branches.ts gates on the attendance module).
  - Also extended `getBookingServices` to project `linkedHppProductId` so the create-sheet can show the HPP-deduction hint.

  **Calendar header (`/booking/index.tsx`)** gains two new controls in the top-right cluster:

  - **Branch picker** — `<select>` populated from `listBookingBranches`. Auto-picks the tenant's main branch (or first available) on mount via a guarded `setState` during render; only rendered when `branches.length > 1`. Single-branch tenants see no picker. The selected branch drives both booking filtering and the greying.
  - **`+ Buat Booking` button** — pre-selects the first active resource + the next hour rounded to `:00`. Opens the existing `CreateBookingSheet`. Disabled when `resources.length === 0` to avoid opening an unusable sheet.

  **Booking filtering by branch.** `bookingList` now filters out any booking whose `branchId` doesn't match the selected branch. Legacy bookings with null `branchId` show in every branch view as a fallback (so existing test data doesn't disappear when the picker is added).

  **Out-of-hours greying** (`DayColumnView`):

  - New `businessHours` prop (`Array<{ day: 0-6, open, close }> | null`) from the selected branch.
  - `isWithinHours(day, hour)` helper checks `business_hours[day_of_week]` against the slot's hour. Null business_hours = always allow (matches server null-gating).
  - Out-of-hours slots get `cursor-not-allowed bg-gray-50` styling AND skip rendering the click-capture button (so the cell is truly non-interactive, not just visually disabled — matches the pattern shipped in JUR-182's POS cashier fix).

  **`CreateBookingSheet`** extensions:

  - Accepts the new `branchId` prop (from the header picker) and passes it through to `createBooking`. Single-branch tenants get the auto-resolved id (from `selectedBranchId` default) so the server's "Pilih cabang dulu" path never fires.
  - New empty-state when `services.length === 0`: "Belum ada layanan. Buat item di Inventaris dan centang 'Bisa dipesan di booking'." — points the tenant directly at the JUR-183 1/2 toggle.
  - New HPP linkage hint banner with a Sparkles icon when ANY picked service has `linkedHppProductId`: "Konsumsi inventaris (resep HPP) akan dihitung otomatis saat layanan selesai." Primes the tenant for the future POS-conversion flow even though Phase 1 doesn't auto-deduct yet — sets expectation without overpromising.

  **No DB migration.** All schema in place from JUR-166/182.

  **Typecheck green.**

  **JUR-183 is now complete** (combined with the 1/2 commit). All seven items from the rewritten ticket spec shipped:

  1. ✅ `is_bookable` toggle in `/inventory/items` (1/2)
  2. ✅ Business hours editor in `/master/branches` (already existed pre-JUR-183)
  3. ✅ Branch picker in calendar header (this commit)
  4. ✅ `+Buat Booking` button (this commit)
  5. ✅ Out-of-hours calendar greying (this commit)
  6. ✅ Create-sheet branchId field + HPP hint (this commit)
  7. ✅ Blackout dates editor (1/2)

- a2f8a1f: JUR-183 (1/2) — inventory `is_bookable` toggle + blackout dates editor.

  **Why.** JUR-182 added the `is_bookable` / `booking_color` / `booking_duration_min` columns to `inventory_items` so services would live in the canonical inventory module. JUR-184 set up the per-service enforcement (working hours, blackout dates). What was missing: the UI surfaces to actually let tenants flag items as bookable and to manage the holiday list.

  **`/inventory/items` changes.**

  - **List row** gains a "Bisa Dipesan" blue badge next to the existing "Resep" badge whenever `is_bookable=true`. Scannable at a glance.
  - **Toolbar filter** — new "Hanya bisa dipesan" checkbox alongside the existing "Hanya stok rendah", scoped to the current view (sellable / ingredients / all).
  - **Create + edit forms** gain a new `BookingFields` component (exported from `items.index.tsx`, reused by `items.$itemId.tsx`). Pattern:
    - Toggle "Bisa dipesan di booking" — gates the inner section.
    - When ON: number input "Durasi booking (menit)" — nullable, falls back to `booking_settings.slot_duration_min`. Hint: "Kosongkan = pakai durasi slot default."
    - When ON: 8-swatch color picker (blue / purple / pink / green / amber / red / cyan / grey) + a "no color" × button. Drives the calendar bubble color.
  - **Server fns** (`inventory.ts`):
    - `itemInput` Zod schema gains `isBookable`, `bookingColor`, `bookingDurationMin`.
    - `createInventoryItem` defaults `isBookable=false` (opt-in), passes through the other two.
    - `updateInventoryItem` uses the existing explicit-choice pattern (`...(updates.isBookable !== undefined ? { isBookable } : {})`) so partial updates don't clobber unrelated fields.
    - `listInventoryItems` SQL gets `i.is_bookable` in SELECT + GROUP BY; row mapper exposes it as `isBookable`.
    - `getInventoryItem` uses `select()` already, so the new columns flow through automatically.

  **`/booking/settings` Section 3 (Hari Libur).**

  The placeholder is replaced with a real editor:

  - Date input (HTML5 `type=date` with `min=today`) + "+ Tambah" button.
  - Inline pills list of saved dates with `×` to remove. Pills format dates as Indonesian long form ("17 Agu 2026") for scannability.
  - Auto-save on add/remove via `saveBookingSettings({ blackoutDates: [...] })` (existing fn from JUR-184). Empty state when none.
  - Duplicate guard with toast on attempted re-add of an existing date.
  - Sorted ASC so the next holiday is leftmost.

  Routes through `saveBookingSettings`, which means the section reads current mode/slot/cap state from the parent component to avoid clobbering them with stale defaults.

  **Enforcement was already shipped** in JUR-184's `createBooking` (via `assertNotBlackoutDate` reading `booking_settings.blackout_dates`). This commit just adds the UI to populate that column.

  **No DB migration.** All columns already exist from JUR-182's 0062.

  **Out of scope (deferred to commit 2/2):** branch picker in calendar header, `+ Buat Booking` button, out-of-hours greying, create-sheet branchId field, HPP linkage hint.

- a2f8a1f: JUR-184 Booking setup replacement — unified `/booking/settings` + staff sync + concurrency cap.

  **Why.** The JUR-166 setup wizard was a 3-card industry picker. JUR-182 dropped the service seeding it did, and the JUR-182 follow-up dropped the resource seeding. What was left was a UI that did nothing but write `industry_template` (cosmetic) and `slot_duration_min` (which a tenant should just type). Smoke testing surfaced the template framing as confusing — the tenant's mental model isn't "what industry am I", it's "tell me my slot duration, my staff, and my chair capacity, done."

  **Migration 0063 (`booking_max_concurrent`, applied to prod).**

  ```sql
  ALTER TABLE booking_settings
    ADD COLUMN max_concurrent_slots integer;  -- nullable
  ```

  Use case: a barbershop with 3 stylists but only 2 chairs sets this to 2. The calendar still allows 3 staff columns, but `createBooking` rejects a 3rd overlapping confirmed/in-progress booking with `"Slot penuh — kapasitas 2 sedang dipakai."` Null = no cap (existing per-resource overlap rule still applies).

  **Server fns (`apps/web/src/server/functions/booking.ts`).**

  - **NEW** `getBookingSettingsState()` — single round-trip loader for `/booking/settings`. Returns settings + every resource joined to its linked `tenant_members` row (avoids N+1 in the UI).
  - **NEW** `saveBookingSettings({ mode, slotDurationMin, maxConcurrentSlots, blackoutDates? })` — single upsert. Flips `setup_completed=true`. Replaces the template-driven `completeBookingSetup`.
  - **NEW** `addBookingStaff({ name, email?, phone? })` — two paths:
    - Email empty: writes only `booking_resources` (name, kind='staff', member_id=NULL). Requires `booking.write`. For stylists who don't need a login.
    - Email present: also calls Supabase `auth.admin.inviteUserByEmail` + inserts `tenant_members` (role='staff', pinned to the tenant's main branch via `tenant_member_branches`) + links via `booking_resources.member_id`. Requires both `booking.write` AND `members.manage` so a supervisor can't escalate privileges via this path. Idempotent — re-adding a tenant member that already exists reuses the existing row instead of throwing.
  - **NEW** `deleteBookingResource({ id })` — drops the `booking_resources` row only. Does NOT touch `tenant_members`. Soft-blocks when active bookings (status NOT IN cancelled/completed/no_show) reference the resource.
  - **EXTEND** `createBooking` — after the existing per-resource overlap check, adds a tenant-wide concurrency check when `max_concurrent_slots IS NOT NULL`. Scoped to the booking's branch when set, tenant-wide when null. Throws `CAPACITY_FULL` with the Indonesian friendly message.
  - **DROP** `completeBookingSetup` (replaced by `saveBookingSettings` + `addBookingStaff`).

  **Routes.**

  - **NEW** `/booking/settings` — single-page form, three sections (Konfigurasi Slot, Staf, Hari Libur). Gated on `booking.write`; redirects to `/booking` otherwise. First-time setup AND ongoing edits use the same surface — when `setup_completed=false`, a hint banner appears at the top; saving any field flips it to true.
  - **DELETE** `/booking/setup` template picker (file replaced with a `redirect({ to: '/booking/settings' })` shim so old sidebar bookmarks and the existing index empty-state CTA keep working until JUR-183 ships its newer CTAs).
  - **UPDATE** `/booking/index.tsx` — empty-state CTA points to `/booking/settings` instead of `/booking/setup`.

  **Sidebar (`apps/web/src/lib/constants.ts`).**

  - `booking.navSetup → booking.navSettings` (label "Pengaturan" / "Settings"); `href` `/booking/setup → /booking/settings`.
  - `ROUTE_TITLE_KEYS` updated to match.

  **Drizzle schema.** `bookingSettings` gains `maxConcurrentSlots: integer('max_concurrent_slots')` (nullable). No other schema changes.

  **i18n.** Booking namespace expanded with ~30 new keys (id + en) for the settings form: mode picker copy, slot/concurrency labels + hints, staff CRUD copy, email-invite hint variants based on `members.manage` permission, etc. Dropped: `setupDesc`, `templateSalon/Barbershop/Klinik`, `templateXxxDesc`, `setupSuccess`. Renamed: `navSetup → navSettings`, `setupTitle → settingsTitle`.

  **Staff sync model (per Mantra Maker's ask).**

  - Add staff from `/booking/settings` with email → also lands in `/settings/members` (bidirectional convenience).
  - Delete staff from `/settings/members` → `booking_resources.member_id` auto-SET-NULL via the FK added in JUR-182. The calendar keeps showing the resource name; history stays intact.
  - Delete staff from `/booking/settings` → only the `booking_resources` row drops; tenant_members untouched. Soft-blocked if active bookings exist.

  **Workstation concurrency deferred** (per the (a) decision in the design check-in). Simple tenant-wide cap ships in v1; promote to `kind='station'` resources only if a real tenant complains.

  **Out of scope (still JUR-183):** `is_bookable` toggle in `/inventory/items`, business-hours editor in `/master/branches`, branch picker in the calendar header for multi-branch tenants, the `+Buat Booking` button + first-run banner + calendar greying for out-of-hours slots.

  **Acceptance verified by typecheck + spec walkthrough.** Manual smoke recommended before deploy:

  1. `/booking` for a fresh tenant → empty-state CTA → lands on `/booking/settings`.
  2. Fill mode + slot duration + max concurrent → save → `setup_completed` flips → calendar renders.
  3. Add staff without email → resource-only badge; calendar column appears.
  4. Add staff with email → Brevo invite email lands; check `/settings/members`; "Tim" badge in `/booking/settings`.
  5. Set `max_concurrent_slots=2`, create 2 overlapping bookings, try a 3rd → friendly Indonesian error.
  6. Visit old `/booking/setup` URL → redirected.

- a2f8a1f: JUR-185 — Subdomain MVP: `<slug>.vintra.my.id` queue page for cuci motor.

  **Why this exists.** A cuci motor tenant is waiting on the JUR-167 queue feature and asked for a public-facing URL their customers can share to check the live queue before driving over — and they want it on a subdomain so the URL itself doubles as a marketing artifact for Vintra. The full Tenant Public Site project (JUR-175 wildcard infra + JUR-176 template editor + JUR-177 public rendering + JUR-178 booking sub-route) is a multi-week epic. This ticket is an intentional MVP wedge that ships the highest-value piece (live queue page on a subdomain) in one commit, deferring the templated landing/editor/SEO work until more tenants ask.

  **Migration 0065 (applied to prod):**

  ```sql
  ALTER TABLE tenants ADD COLUMN public_slug text;
  CREATE UNIQUE INDEX tenants_public_slug_unique_idx
    ON tenants (public_slug) WHERE public_slug IS NOT NULL;
  ```

  Partial unique index — null is allowed (most tenants haven't claimed), only claimed slugs collide. Distinct from the existing `tenants.slug` (auto-generated owner identifier, URL-unfriendly). `public_slug` is the tenant-chosen vanity component.

  **Server fns** — new `apps/web/src/server/functions/public-tenant.ts`:

  - **`claimPublicSlug({ slug })`** — gated on `booking.write`. Validates regex `^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$` (3-30 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphen). Blocks ~70 reserved slugs (admin, api, app, www, dashboard, login, all SaaS module paths, brand terms, common test/dev names). Friendly Indonesian errors for each rejection class. Uniqueness enforced by the partial index; the redundant explicit check just gives a better error message.
  - **`getMyPublicSlug()`** — auth-gated read for the settings UI ("what's my current slug?").
  - **`getPublicQueueData({ slug })`** — **NO AUTH**. Tightly-scoped public read. Returns only safe fields: tenant business name + slug, branches (name/address/business_hours only — no lat/long), bookable services (name/price/color/duration), queue snapshot stripped to `{ resourceId, ticketNumber, firstName, status }` — phone numbers, customer ids, notes, full last names, all withheld. Returns null when no tenant matches → route renders 404.

  **Public route** — new `apps/web/src/routes/q.$slug.tsx`:

  - Mobile-first single-column layout (customers will hit this from phones while in transit).
  - No auth, no `_authed/` layout, no sidebar / navbar — pure tenant-facing public surface.
  - Polls `getPublicQueueData` every 15s via `refetchInterval` for live queue updates. No WebSocket needed for v1; 15s feels live enough at cuci motor speed.
  - Mode-aware:
    - `mode='queue'` → big queue card with per-resource columns, large queue counts ("**3** antrian"), animated LIVE indicator, in-progress ticket call-out.
    - `mode='slot'` or other → simpler "Datang langsung atau hubungi" card (queue card hidden, not broken).
  - Open/closed indicator from `branches.business_hours` for today's day-of-week.
  - Services list with price + duration + color swatch.
  - Full week hours grid (only rendered when business_hours configured).
  - Footer: "Powered by Vintra" link → marketing channel for inbound tenants.
  - 404 component for unclaimed slugs.

  **Settings UI** — new `PublicSlugSection` card in `/booking/settings`:

  - Read-only display when slug is claimed: full URL preview with copy + open-in-new-tab buttons.
  - Edit mode with input + Klaim button when unclaimed or re-claiming.
  - Local regex check for instant feedback as the user types.
  - Help text + amber warning copy when re-claiming an existing slug (old links break).
  - 10 new i18n keys in id + en.

  **Nginx vhost** — new `deploy/nginx/public-tenant.conf`:

  - Matches `~^(?<sub>[a-z0-9][a-z0-9-]{1,28}[a-z0-9])\.vintra\.com$` via regex. Existing exact-match vhosts (`vintra.my.id`, `api.vintra.my.id`) have higher specificity so they catch their own hostnames first — only OTHER subdomains hit this vhost.
  - Internal rewrite: `<sub>.vintra.my.id/<path>` → `/q/<sub>/<path>` via `rewrite ... break`. Browser URL bar stays at the subdomain (this is proxy_pass, not 301).
  - Static assets (`/_build`, `/assets`, `/images`, `/fonts`, favicons) served directly from `dist/client` without the rewrite — same paths work across all subdomains because we have one app build.
  - SSL via Cloudflare Origin Certificate (15-year, zero-renewal) — runbook explains setup.

  **Deploy runbook** — new `deploy/SUBDOMAIN-DEPLOY.md`:

  End-to-end one-shot runbook covering:

  1. **DNS migration to Cloudflare** (one-time, ~30 min + propagation window): sign up, add site, verify record import, flip nameservers at Hostinger, add wildcard A record with proxy ON.
  2. **SSL via Cloudflare Origin Certificate**: generate in CF dashboard, copy to `/etc/ssl/cloudflare/`, set CF SSL mode to Full (strict).
  3. **Nginx vhost install**: scp + symlink + nginx -t + reload.
  4. **App deploy**: standard `./deploy.sh web`.
  5. **Smoke test**: claim a test slug, visit subdomain, verify 404 path.
  6. **Troubleshooting table** for common SSL / vhost / asset issues.
  7. **Optional hardening section** for Cloudflare IP allowlisting + WAF (defer until prod abuse seen).

  **Out of scope** (intentional defers):

  - Customer self-join queue from the public page → needs honeypot + rate limit + WA verification. Defer until usage proves the demand.
  - Branded look, photos, template editor → JUR-176 territory. v1 ships a clean default style.
  - SEO meta tags / OpenGraph cards → JUR-177 territory. v1 has basic `<title>` only.
  - Custom domains → JUR-179.
  - Multiple sub-pages (`/menu`, `/about`) on the subdomain → root only for v1.
  - Slot-mode-specific public booking flow → JUR-178 builds the full mode-aware booking UI under the same subdomain story.

  **Future relation to the full project.** Every piece here is intentionally replaceable when JUR-175-178 ship: the slug column migrates to whatever JUR-175 designs for subdomain claim, the queue page either absorbs into JUR-178's `/book` mode-aware route or stays as a permanent `/q` shortcut. The MVP doesn't paint us into a corner.

  **Acceptance criteria** (verified by typecheck + spec walkthrough; smoke test required after deploy):

  1. Tenant claims slug `cuci-mantra` from `/booking/settings` → preview URL appears.
  2. Visit `cuci-mantra.vintra.my.id` (after DNS + nginx deployed) → mobile-first queue page with live counts, polls every 15s.
  3. Visit `unclaimed-slug.vintra.my.id` → 404 page (not a crash, not the SaaS app).
  4. Reserved slug (`admin`, `pos`, etc.) → validation error in claim form.
  5. Duplicate slug claim → uniqueness rejection.
  6. `/q/cuci-mantra` path also works (the internal route that nginx rewrites subdomain requests to).

  Typecheck green. Migration applied to prod.

- a2f8a1f: JUR-46 — split deploy script + ship the api ops artifacts.

  `./deploy.sh api` now does what it says (it previously ran the
  old NestJS+Bun flow which never matched the Go rewrite):

  - Cross-compiles a static linux/amd64 Go binary locally with
    `CGO_ENABLED=0 -trimpath -ldflags "-s -w -X main.appVersion=$SHA"`.
  - rsyncs to `/home/ubuntu/prod/vintra-api/bin/api.new`.
  - Atomic swap + `sudo systemctl restart vintra-api` (NOPASSWD rule
    for the unit, set in JUR-58 setup).
  - Polls `/healthz` via ssh to fail the deploy on a crash-on-startup.

  Defaults assume the api shares the web VPS (`API_SERVER_IP` falls back
  to `WEB_SERVER_IP`); override when you split hosts later.

  New repo artifacts:

  - `deploy/api/vintra-api.service` — systemd unit with
    `ProtectSystem=strict`, memory caps (MemoryMax=900M /
    MemoryHigh=700M), graceful SIGTERM (20s).
  - `deploy/nginx/api.vintra.my.id.conf` — nginx vhost for
    `api.vintra.my.id` proxying to `127.0.0.1:4000`. Includes
    gzip, WebSocket upgrade headers (for future SSE), 60s timeouts.
  - `deploy/api/README.md` — one-time VPS setup checklist (Redis
    config, .env layout, certbot, sudoers NOPASSWD rule, first deploy).

  `ecosystem.config.cjs` was already clean (only `vintra-web`),
  no changes there.

- a2f8a1f: JUR-6: Customer database (per-tenant) — foundation for loyalty + promo codes.

  Promotes the per-sale `customer_name + customer_phone` snapshot into a real `customers` table scoped per tenant. Toko + Komplit tenants get a full database UI (`/pos/customers`); Free tenants keep the existing per-sale snapshot behaviour.

  **Schema (migration 0022)**:

  - `customers` table: tenant-scoped, with name, normalised phone (`62...` form), email, notes, plus aggregates (`total_spent`, `visit_count`, `last_visit_at`).
  - Partial unique index on `(tenant_id, phone) WHERE phone IS NOT NULL` so anonymous walk-ins don't collide while real customers dedup on phone.
  - `pos_sales.customer_id` FK added; backfilled by grouping existing rows on a SQL phone-normalisation CTE.

  **Server**:

  - `listCustomers`, `searchCustomersByPhone`, `getCustomer` (with recent 20 sales + per-sale item count), `upsertCustomer`, `deleteCustomer` — all gated behind the new `customer_db` feature flag (Toko + Komplit).
  - `createSale` automatically upserts a customer row when name+phone are provided AND the tier has `customer_db`. Aggregates (`total_spent` += sale total, `visit_count` += 1, `last_visit_at` = now) are bumped atomically inside the same transaction.
  - `voidSale` reverses the aggregates (`GREATEST(0, total_spent - sale.total)`, same for visit count). `last_visit_at` left as-is — captures "when the customer last walked in" which a void doesn't undo.
  - Phone normalisation helper (`normalizePhone`) shared between cashier upsert + customer admin form so all phone variants ("08123", "+62 8123", "08-1-2-3") map to the same canonical "62..." form.

  **UI (mobile-responsive throughout)**:

  - New `/pos/customers` route — searchable list with tap-to-detail. Card layout that flows naturally on phone (full-width, stacked rows with avatar + aggregates) and tablet (same shape, more horizontal space).
  - New `/pos/customers/$customerId` detail — profile card with WhatsApp deep-link on the phone, three-stat grid (total spent, visit count, last visit), notes block, recent-sales timeline (links into `/pos/sales/$saleId`). Stats reflow 2-col on mobile, 3-col on tablet+.
  - New `CustomerFormSheet` — sheet-based create/edit form with proper validation, phone helper text explaining auto-normalisation.
  - Cashier customer-capture block (Toko+) gains debounced autocomplete: as the cashier types in the phone field, we surface up to 8 matching customers; tap to pre-fill name. Free tier renders the same fields without the autocomplete dropdown.
  - POS subnav adds "Pelanggan" link gated behind the `customer_db` feature flag.
  - i18n keys added for the new nav label (en + id).

  **Tier gate**:

  - `customer_db` added to `POS_TOKO_FEATURES` constant.
  - Server functions throw "Database pelanggan hanya tersedia di paket Toko atau Komplit" for Free callers.
  - Subnav link hides when feature absent.

  **What's next** (per the parity-push milestone plan):

  - W2: loyalty points (earn + redeem, blocked by this customer table)
  - W3: promo codes (per-customer cap blocked by this customer table)
  - W4: ingredient consumption wiring
  - W5: P&L report + thermal printer
  - W6: polish + onboarding + Komplit launch

- a2f8a1f: JUR-7: Line-level discount in cashier (Toko+ feature).

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

- a2f8a1f: Fix admin handoff WhatsApp notification never delivering. The
  `admin_phone` column was storing user input verbatim
  ("08118492869") and the worker was concatenating it as
  "08118492869@s.whatsapp.net" — not a valid WhatsApp JID. whatsmeow
  ran USync to discover the (non-existent) user, timed out at 30s,
  retried 2 more times, and dropped the notification.

  Two fixes:

  - `wa_instances.Update` now runs admin_phone through
    `whatsapp.NormalizeJID` before saving, so "08..." gets canonicalised
    to E.164-without-plus ("628..."). Stored as digit-only for parity
    with the rest of the column.
  - `dispatchAdminNotification` defensively normalises again at send
    time so older rows (or any row that bypassed the API) still
    produce a valid JID. Logs and skips with a clear error if the
    number is unparseable instead of enqueueing a doomed send.

- a2f8a1f: JUR-74 follow-ups from review:

  - Pengaturan AI now has a single "Simpan Pengaturan" button at the
    bottom of the form (was duplicated — one per card). Both AI config
    and Handoff fields persist together in a single PATCH.
  - Conversation header gains a per-contact "Jeda AI" / "Aktifkan AI"
    toggle, always visible. Lets admin pause auto-reply for a specific
    contact even when AI itself didn't trigger handoff (e.g., during
    a manual negotiation). Mirrors the banner button when in handoff.
  - Heuristic handoff detector switched from substring to regex with
    filler tolerance. Production case "aku alihkan **chat ini** ke
    admin" was missed by the substring matcher and never fired the
    notification. Regex now also catches "nanti admin yang akan",
    "admin yang bantu", "diteruskan ke admin", and "hubungin admin".
  - 5 new positive test cases covering the missed phrasings.

- a2f8a1f: Fix the per-contact "Jeda AI" / "Aktifkan AI" toggle silently no-opping
  on Mantra Maker — the button label never flipped because the API
  returned 200 but didn't actually update any row.

  Root cause: the handoff endpoint had the JID in a path param
  (`/contacts/:remoteJid/handoff`). Fiber treats `.` as a route
  delimiter and silently truncated the suffix of JIDs like
  `6285119786395@s.whatsapp.net`, so the `WHERE remote_jid = ?`
  filter matched zero contacts. The query is `:exec` so no error
  surfaced.

  Fixes:

  - Move JID into the request body, mirroring `/contacts/read` (the
    same pattern that already works for mark-read).
  - Convert the two handoff queries to `:execrows` and 404 when zero
    rows update — silent no-ops are how this bug hid for a release.
  - Add an optimistic update on the React side so the button label
    flips instantly instead of waiting for the next 5s contact-list
    refetch. Rolled back on error.

- a2f8a1f: JUR-74 — handoff workflow UI (web app side):

  - Pengaturan AI gains a "Handoff ke Admin" section: admin WhatsApp
    number + N-hour auto-resume window. Admin number is digit-normalized,
    validated 8–15 digits, and required to differ from the instance's
    own paired number (matches the API's self-send guard).
  - Chat sidebar pins contacts in handoff to the top with a small
    "Admin" pill so the operator sees them at a glance.
  - Conversation header gains a "Butuh admin" pill, and a banner above
    the messages area shows the AI's reason + summary, the countdown
    until auto-resume, and a one-click "Aktifkan kembali AI" button
    that POSTs to the new contact handoff PATCH endpoint.
  - New `updateContactHandoff` server function calling
    `PATCH /v1/wa/instances/:id/contacts/:remoteJid/handoff`.

  Backend glue:

  - `ListWaContacts` query now selects + returns the handoff columns
    (`needs_human`, `handoff_at`, `handoff_reason`, `handoff_summary`)
    and pins handoff contacts to the top via
    `ORDER BY needs_human DESC, last_message_at DESC NULLS LAST, ...`.
  - `instanceResp` and `updateInstanceReq` add `adminPhone` +
    `handoffAutoResumeHours`. The `Update` handler validates the hours
    range (0..168) and refuses an admin phone that matches the
    instance's own number (digit-normalized).

- a2f8a1f: JUR-75 — inbound WhatsApp media (image / sticker / document / video / audio)
  gets downloaded, decrypted, and uploaded to S3 as it arrives.

  - New schema columns on `wa_messages`: `media_mime`, `media_size_bytes`
    alongside the existing `media_key` (now actually populated).
  - New Go S3 client wrapper at `apps/api/internal/storage/s3.go`.
    Uses `aws-sdk-go-v2`, reads the same `AWS_REGION` /
    `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_S3_BUCKET`
    env the web app already needs. Optional at boot — missing creds
    log a warn and inbound media silently passes through with
    `media_key=NULL`.
  - Provider's inbound subscriber synchronously downloads via
    `whatsmeow.Client.Download()`, uploads to S3 with key
    `{tenantId}/wa/{instanceId}/{externalId}.{ext}` and tag
    `kind=wa-media` (drives the future 3-day lifecycle from JUR-79).
  - `wa:incoming` worker writes the three media columns alongside
    the existing `type` and `body` (caption) fields.
  - Failure handling: download timeout / S3 error logs warn and
    persists the row with empty media_key so chat history still
    shows the message — JUR-77 will render "Media tidak tersedia".

- a2f8a1f: JUR-76 — operator can attach + send images from the chat composer.

  - New paperclip button in the composer, opens a file picker scoped
    to image/jpeg, image/png, image/webp.
  - 5 MB client-side cap (matches `s3-storage.ts` server-side cap)
    with toast on oversize.
  - Pending image preview above the textarea with a remove "X". The
    textarea becomes the image caption when an attachment is present.
  - New `sendWaImage` server fn — parses the data URL, uploads to S3
    via `uploadWaMediaOutbound` (added in JUR-77), then POSTs the
    resulting key to the API. Bytes never traverse the API.
  - New `POST /v1/wa/instances/:id/messages/image` endpoint validates
    the s3Key starts with `{tenantId}/wa/{instanceId}/` so a malicious
    caller can't reference another tenant's S3 object.
  - New `wa:send_image` task handler (mirrors `wa:send` — same rate
    limit, same retry, same idempotency rules) downloads from S3,
    calls `whatsmeow.Client.Upload(MediaImage)`, sends ImageMessage.
  - Outbound image bubbles render via the JUR-77 MediaImage component
    immediately after send (status flows pending → sent).

- a2f8a1f: JUR-77 — render WhatsApp media in chat bubbles (image, sticker,
  document) using lazy-fetched signed S3 URLs.

  - New `getWaMediaUrl({messageId})` server fn — validates tenant
    scope via the API, then signs a 5-minute URL via the existing
    `s3-storage.ts` helper. Returns null for missing/expired media.
  - New `GET /v1/wa/messages/:id` API endpoint (tenant-scoped) so the
    signing fn can verify ownership before touching S3.
  - New bubble variants: image (with click-to-zoom lightbox), sticker
    (chrome-free, 120×120), document (icon + size + open in new tab).
  - React Query caches the signed URL for 4 minutes (TTL minus a
    1-min safety margin).
  - Fallback "Media tidak tersedia" rendered when S3 returns 404
    (3-day lifecycle elapsed) or when the inbound download failed.
  - New `getWaMediaSignedUrl()` helper in `s3-storage.ts` plus a
    `uploadWaMediaOutbound()` helper ready for JUR-76 outbound send.
  - `messageResp` API shape gains `mediaKey` / `mediaMime` /
    `mediaSizeBytes` so the bubble component knows how to render
    without a second round-trip.

- a2f8a1f: JUR-78 — emoji picker in the WhatsApp chat composer.

  - New smiley button between the paperclip and the textarea.
  - Click → popover renders above the composer with a searchable
    emoji grid.
  - Click an emoji → inserts at the textarea's current cursor
    position (not appended at end), picker closes, focus returns to
    the textarea, caret moves past the inserted character.
  - Picker chunk lazy-loaded — `emoji-picker-react` (~25 KB gzipped)
    only ships the first time the smiley button is clicked.
  - Picker closes on outside click + Escape.
  - Native emoji rendering, no remote sprite, no preview pane,
    no skin-tone selector (kept compact).

- a2f8a1f: JUR-8: Loyalty points (earn + redeem). Komplit-tier feature.

  - **Schema**: `customer_loyalty_balances` + `customer_loyalty_movements` tables; `loyalty_enabled / earn_rate / redeem_rate` on `pos_settings`; `loyalty_points_earned / redeemed / redeem_amount` on `pos_sales`.
  - **Feature flag**: `loyalty_points` added to `POSFeatureFlag`, included only in `POS_KOMPLIT_FEATURES`. Bisnis does not get loyalty — it's the Komplit headline.
  - **createSale**: when loyalty active + customer attached, accepts `redeemPoints`. Validates balance + post-discount cap, applies redeem as a pre-tax discount distinct from `discount_amount` (so future P&L can split marketing vs loyalty burn-down). Earns on the post-redemption pre-tax base. Earn + redeem ledger rows + balance upsert all in the same transaction. Returns a loyalty echo (`{ priorBalance, pointsEarned, pointsRedeemed, redeemAmount, newBalance }`) for the success modal.
  - **voidSale**: writes compensating `adjust` movements + reverses balance delta. `lifetime_earned` / `lifetime_redeemed` are NOT reversed (historical truth).
  - **New server fns**: `getCustomerLoyaltySummary` (balance + last 50 movements) and `adjustLoyaltyPoints` (admin override; requires `pos.manage`).
  - **POS Settings → Loyalty section** (Komplit-gated): enable toggle, earn-rate input, redeem-rate input, live preview ("belanja Rp 100.000 → 100 poin").
  - **Cashier**: redeem affordance pinned under the customer slot — only visible when a customer is attached + tenant has loyalty on. Shows live balance ("Saldo poin: 1.250 (≈ Rp 12.500)"), points input with max-cap, "Tukar maks" quick-action, "Hapus" reset. Cart breakdown row "Tukar poin (X) -Rp Y" feeds the live total. Server is the source of truth on validation.
  - **Sale-success modal**: new "Loyalty pelanggan" block listing redeemed / earned / new balance.
  - **Receipt PDF**: thermal + A4 layouts now emit "Tukar poin" / "Dapat poin" / "Saldo" footer block.
  - **Customer detail page**: new "Loyalty Poin" section (Komplit-gated) with balance + lifetime totals + last 50 movements (typed: earn / redeem / adjust / expire).

- a2f8a1f: JUR-80 (backend half): capture inbound WhatsApp reactions instead of
  dropping them. v1's `isSkippableMessage` swallowed reactions to keep
  "[Pesan tidak didukung]" bubbles out of the inbox; v2 stores them in
  a new `wa_reactions` table so the operator gets visibility on the
  👍 / ❤️ signal customers send (yes-on-product-photo, thanks-on-receipt).

  - New table `wa_reactions` with unique `(parent_message_id, sender_jid)`
    so the same sender swapping their reaction overwrites in place;
    removing the reaction (whatsmeow delivers empty `Text`) deletes the
    row. No audit history kept for v2.
  - Provider (`registry.go`) now detects `ReactionMessage` BEFORE
    `isSkippableMessage` and enqueues a dedicated `wa:reaction` task
    carrying the parent's external ID + emoji + sender JID. Returns
    early so the rest of the inbound pipeline (dedupe / media download /
    `wa:incoming`) doesn't see reaction events.
  - New `WAReactionHandler` worker resolves parent message UUID by
    external ID (tenant + instance scoped to prevent cross-tenant
    cross-link), then upserts or deletes. Orphan reactions (parent
    deleted/expired) log warn + ack-success — no point retrying.
  - `wa:reaction` queue added to asynq config (concurrency 1; reactions
    are tiny, single-row upserts).

  UI rendering of the reaction pill on bubbles is the second half — see
  the JUR-80 frontend changeset (separate commit). Until that ships, the
  table fills up but the inbox UI stays unchanged. This split lets us
  verify the data flow in prod before committing UI cycles.

  Outbound reactions (operator long-press → emoji picker) remain
  out of scope per the JUR-80 ticket.

- a2f8a1f: JUR-80 (frontend half): render the captured reactions on bubbles.

  - API: `GET /v1/wa/instances/:id/messages` now fan-out fetches
    reactions via `ListReactionsForMessages($1::uuid[])` (one round
    trip, not N) and pivots them into a `reactions` field on each
    message response.
  - Web: bubble component renders a small pill row just below the
    bubble, on the same side as the bubble. Identical emojis are
    grouped with a count so 3 senders all reacting 👍 takes one
    pill-width, not three. Negative top margin pulls the pill
    to overlap the bubble's bottom edge — matches WhatsApp's
    native UI.
  - Sticker bubbles get reactions too (the sticker branch was a
    separate render path).

  Pairs with the backend half — once both are deployed, the UI
  shows reactions in real time as the worker upserts them. Empty
  reactions array means the omitempty side of the API response
  omits the field entirely; the UI handles `undefined` cleanly.

- a2f8a1f: Fix WhatsApp module permissions and dashboard error states (JUR-84):

  - Add dedicated `whatsapp.read` and `whatsapp.manage` permissions, seeded
    for owner/admin (both) and supervisor (read only). Staff and cashier no
    longer see the WhatsApp section in the sidebar.
  - Replace the placeholder `requirePOSAccess()` gate on all WhatsApp
    server functions with `requireWAAccess()` / `requireWAManageAccess()`
    so reads and mutations are properly scoped to the right roles.
  - Rewrite the WhatsApp dashboard loader to distinguish three failure
    modes — forbidden, api error, and no plan — instead of collapsing all
    three into the misleading "Belum ada paket aktif" message that showed
    up even for tenants with an active subscription.

- a2f8a1f: Gate the entire `/whatsapp/*` route tree at the layout level (JUR-84
  follow-up): users without `whatsapp.read` now bounce to `/dashboard`
  on direct URL access instead of seeing an empty list with a working
  "Tambah WhatsApp" button. Read-only viewers (supervisor role) keep
  list access but no longer see the add/delete affordances.
- a2f8a1f: JUR-85: HPP wizard save no longer wipes the recipe on partial failure.

  Two layers:

  - New `replaceProductMaterials` server fn — DELETE existing rows +
    INSERT new ones in a single Drizzle transaction. If any insert fails
    the whole rewrite rolls back, so a recipe is never left half-empty.
  - Wizard `handleSaveCalculation` is restructured to do all fail-fast
    validation (resolving unitIds for every row, auto-creating any new
    materials) BEFORE the destructive replace. If a unit can't be
    resolved or a material create fails, the DB is untouched.

  Verified via Playwright on Mantra Maker: the resolveUnitId error
  still surfaces on certain Vite-HMR states (filed as a follow-up),
  but the recipe now survives intact through the failure — meeting
  the JUR-85 acceptance criterion.

- a2f8a1f: JUR-89: tenant commission dashboard + bank info + claim flow.

  - /referrals is now a layout with two tabs (Kode / Komisi). Codes page
    is unchanged content-wise, just moved to /referrals (the index).
  - New /referrals/commission page: four stat tiles (Total / Masa Klaim /
    Siap Diklaim / Sudah Dibayar), three sub-tabs (Riwayat Komisi,
    Riwayat Klaim, Info Bank), and a primary "Ajukan Klaim" CTA gated on
    having a claimable balance + a payout method on file.
  - Server fns under `referral-tenant.ts`: getMyCommissionSummary,
    listMyCommissions (with effectiveStatus derived from the
    pending→claimable rollover), listMyClaimRequests, getMyPayoutMethod,
    upsertPayoutMethod, submitClaimRequest.
  - submitClaimRequest opens a transaction: FOR UPDATE locks all
    candidate commissions (pending-past-clawback OR claimable, not yet
    linked to any request), creates the request row, links them by
    setting claim_request_id + flipping status to 'claimable'. Rejects
    if no payout method or if a prior request is still 'submitted'.
  - Best-effort admin email notification on submit, gated behind
    PLATFORM_ADMIN_EMAIL env var. The /admin queue (JUR-90) is the
    authoritative surface; the email is just a heads-up.

  Pending → claimable rollover is computed on-read (no cron job) — the
  next query naturally reflects the rollover when pending_until elapses.

- a2f8a1f: JUR-9: Tenant promotions — codes + product auto-apply + cart auto-apply (Komplit only).

  Single `tenant_promotions` table with a `trigger_type` discriminator covers all three modes — saves us from a v2 "merge promo_codes + product_promos" refactor. The DB CHECK constraint enforces "exactly one mode per row"; partial unique index on `(tenant_id, code)` enforces code uniqueness only for code-mode rows.

  **Schema** (`0027_pos_promotions.sql`):

  - `tenant_promotions` table (CHECK on trigger_type, partial unique on code, FK to inventory_items for auto_product, indexed for cashier hot path)
  - `promo_redemptions` ledger (used for total + per-customer cap enforcement; one row per applied promo per sale)
  - `pos_sales.promo_code_snapshot` + `promo_amount` (sale-level snapshot for code + auto_cart)
  - `pos_sale_items.auto_promo_id` + `auto_promo_amount` (per-line snapshot for auto*product, distinct from JUR-7's `line_discount*\*` so reports can split owner-set promos from cashier manual discounts)

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

- a2f8a1f: JUR-90: admin claim queue + payout marking.

  - New /admin/referrals/claims page with status filter pills (All /
    Submitted / Paid / Rejected) and a sorted table — submitted bubbles
    to the top, then newest first.
  - Detail Sheet with copyable bank info, copyable nominal, list of
    commissions in the claim, admin notes, and two outcomes:
    - **Mark Paid** confirms via ConfirmDialog, propagates `status = paid`
      to every linked `referral_commissions` row, writes a
      `platform_admin_audit_logs` entry, sends a confirmation email to
      the tenant.
    - **Reject** requires a reason, releases linked commissions back to
      `claimable` (no `claim_request_id`) so the tenant can re-submit
      after fixing whatever the admin flagged, writes an audit log
      entry, sends a rejection email with the reason.
  - Both endpoints are gated by `requirePlatformAdmin` and use FOR
    UPDATE row locking inside a transaction. Idempotent on
    `paid → paid` (returns alreadyPaid=true) and `rejected → rejected`;
    blocks `paid → rejected` and vice versa.
  - Sidebar entry "Klaim Referral" added next to "Konfigurasi Referral".

  Tenant-side email notification reuses the existing Brevo `sendEmail`
  helper. Owner email is resolved by looking up
  `tenants.owner_id → supabase.auth.admin.getUserById()`. Send failures
  are logged and never roll back the state change.

- a2f8a1f: JUR-93: resolve LID-only inbound to PN form using whatsmeow's local
  mapping cache, then backfill old `wa_contacts` and `wa_messages` rows
  so master-customer JOINs (and the chat header / sidebar) start showing
  the saved name + phone instead of the raw `152673…@lid`.

  - `registry.inboundSubscriber` now consults
    `conn.Client.Store.LIDs.GetPNForLID()` when the current event carries
    only a LID. whatsmeow auto-populates that cache whenever any prior
    inbound arrived with `SenderAlt`/`RecipientAlt`, so subsequent
    messages from the same privacy-on customer resolve to the PN on
    arrival — no re-pair required.
  - When the cache resolves a previously-unknown PN, the subscriber
    enqueues a `wa:lid_backfill` asynq task BEFORE the `wa:incoming` task.
  - New `WALidBackfillHandler` opens a single transaction:
    `RenameWaContactJid` (UPDATE wa_contacts SET remote_jid = pn,
    lid_jid = COALESCE(lid_jid, old_lid)) → `RenameWaMessagesJid`
    (UPDATE wa_messages SET remote_jid = pn). Idempotent — re-runs on
    already-renamed data return 0 rows and exit clean.
  - Unique-violation (SQLSTATE 23505) means a PN-form contact already
    exists for the same person (rare: identity messaged from two devices,
    one disclosed PN, one didn't). v1 logs warn + no-ops; the merge path
    is a deferred follow-up. No data lost — both rows persist as-is.

  Originally planned around `evt.LIDMapping`, but whatsmeow doesn't
  expose that as a public event — it's purely an internal Store update
  inside `handleEncryptedMessage`. Opportunistic lookup is the right
  shape given the actual library surface.

- a2f8a1f: JUR-94: credit referral commissions on manual admin-recorded payments.

  Closes the referral loop without a payment gateway. Tenant A's code is
  used by tenant B at signup (JUR-91 wrote the attribution); when admin
  records B's payment (any of the four `record*PaymentAndActivate` server
  fns), a `referral_commissions` row is now written inside the same
  transaction with `status='pending'`, `pending_until = now() +
clawback_days`, and `source_invoice_id` pointing back at the
  financial-transaction row.

  Refund-side mirror: `recordRefund` now reverses pending / claimable
  commissions linked to the original invoice; already-paid commissions
  stay at `paid` (money was already wired) and emit an audit-log alert
  for manual recovery.

  Helper lives at `server/lib/referral-credit.ts`. When the real payment
  gateway lands later (JUR-92), the gateway's webhook handler just calls
  the same `record*PaymentAndActivate` fns and this credit logic comes
  along for free — no second implementation needed.

- a2f8a1f: Complete JUR-96 — surface referral discount in `/admin/finance` WA payment sheet:

  The per-tenant detail page already wired `referralAttribution` into all 4 payment sheets (POS / Inventory / Attendance / WA) in the JUR-94 round. The `/admin/finance` page has its own local quick-record WA sheet (admin pastes a tenant UUID directly) that wasn't loading attribution.

  Now: when the admin enters a valid UUID into the Tenant ID field, the sheet fetches `adminGetTenantReferralAttribution` and renders the shared `ReferralDiscountBanner` + `DiscountedTotal` so the admin sees the discount math before submitting. Server still applies the discount via `applyReferralDiscount` (no change to the wire format) — UX-only addition.

- a2f8a1f: JUR-96: extend the referral discount UX to all four admin payment
  sheets (was WA-only), with the discount itself applied **server-side**
  as a single source of truth.

  - New helper `server/lib/referral-discount.ts::applyReferralDiscount`
    looks up the active attribution + 12-month window inside the caller's
    transaction, returns `{finalAmountIdr, discountAmountIdr}`. No-op when
    no attribution exists, so non-referred tenants are unaffected.
  - Wired into all four `record*PaymentAndActivate` server fns
    (attendance, inventory, POS, WhatsApp). The persisted
    `financial_transactions.amount_idr` is now the post-discount figure,
    so the commission credit + the invoice both reflect what the tenant
    actually paid.
  - New shared UI component
    `components/admin/finance/referral-discount-banner.tsx` exports
    `ReferralDiscountBanner` + `DiscountedTotal`. Replaces the duplicated
    banner / line-through / "Hemat" markup that previously only lived in
    the WA sheet.
  - All four sheets (WA, POS, Inventory, Attendance) now accept a
    `referralAttribution` prop and render the discount banner +
    discounted total when present. Komplit bundle banner forwards the
    prop into its embedded POSPaymentSheet too.
  - Tenant detail page forwards `referralAttribution` to all four module
    sections + the Komplit banner.
  - WA path refactor: the client no longer sends the pre-discounted
    number. Both `WaPaymentSheet`s (component + the local copy in
    /admin/finance) submit `plan.priceIdr` (full price), and the server
    applies the discount. Avoids double-discount risk and matches the
    POS/Inv/Attendance pattern (where server already re-computes amounts).

  JUR-97: fix React #418 hydration mismatch on `/referrals/commission`.

  The page used `Date#toLocaleString('id-ID', …)` and
  `Date#toLocaleDateString('id-ID', …)` for date rendering. Server
  (Bun/JSC) and client (V8) produce slightly different output for those
  calls — same root cause as the existing `formatRupiah` NBSP issue
  documented in `lib/currency.ts` (JUR-17).

  Switched the commission page, admin claims queue, and admin referral
  config to use the existing `formatDate` helper from `lib/utils.ts`
  (date-fns + Indonesian locale), which is deterministic across runtimes.
  No more #418 in the console on first load.

- a2f8a1f: Two connected fixes to /settings/roles:

  1. **Global Kasir role now grants `pos.read`.** Cashiers can read `/pos/sales` (transaction history) by default — owners regularly need their cashiers to look up past sales for reprints, refunds, and customer questions. Margin/profit on `/pos/reports` stays gated on `pos.report.profit`, so cashiers gain history visibility without seeing untung kotor / margin.
  2. **UI editability filter now matches the server's.** Globally seeded roles (Kasir / Supervisor / Staff) carry `is_system=false` but `tenant_id=null`. The server's `loadEditableRole` already rejects mutations on them ("Peran bawaan sistem tidak bisa diubah"), but the UI used to bucket them as "Peran kustom" because it only checked `!isSystem`. Saves silently appeared to revert. The filter now requires `!isSystem && tenantId !== null` for the editable section; globally seeded roles join the readonly "Peran bawaan sistem" group where they belong. To customize them per tenant, owners create a new role from scratch (existing templates picker already covers the common cases).

  Prod: the existing global `cashier` row was patched directly to grant `pos.read` (idempotent INSERT into `role_permissions`) plus the description was refreshed to "Membuat transaksi POS dan melihat riwayat penjualannya." Both because the `seed:rbac` script still has the unrelated `ON CONFLICT` constraint issue that prevents a full re-run.

- a2f8a1f: Fix Komplit refund asymmetry — refunding a POS Komplit purchase now correctly deactivates the bundled Inventory + Attendance modules too.

  The Komplit activation path (`recordPOSPaymentAndActivate`) atomically activates POS + Inventory + Attendance, but the refund path (`recordRefund` with `endSubscriptionNow=true`) was only flipping the original transaction's module off. That left tenants with active Inventory + Attendance subscriptions long after their Komplit purchase was refunded.

  Detection: any refund where `moduleKey === 'pos'` AND the original plan's POS tier is `'komplit'` now cascades the deactivation to all three `*_settings` tables and removes all three keys from `tenants.activeModules` in the same transaction. Standalone POS Toko / Inventory / Attendance refunds are unchanged — they keep the single-module deactivation.

  WhatsApp subscriptions are intentionally excluded from the bundle on both sides (activation never touches them, and refunds of Komplit don't disturb them).

- a2f8a1f: Landing page cleanup:

  - Fix WhatsApp AI "mulai" price: was Rp 99rb (wrong), now Rp 49rb (matches the Basic tier in `apps/web/src/routes/_authed/whatsapp/billing.tsx`).
  - Replace the "izin, cuti, dan lembur" bullet in the Absensi highlight section — that feature isn't built. Swapped for two real attendance features (GPS + photo validation, downloadable monthly reports). Filed JUR-95 to revisit when there's demand.
  - Mention WhatsApp AI in the hero subtitle so it's not buried below the fold.
  - Footer: removed the IG/TW/FB/YT social-icon placeholders (no real accounts to link to), wired up the Produk anchors to the actual highlight sections (`/#hpp`, `/#absensi`, `/#whatsapp`; POS + Manajemen Stok land at `/#fitur` until they get their own highlight sections), and added a WhatsApp AI entry.
  - Renamed the HppHighlight section id from the generic `#solusi` to `#hpp` and updated the hero "Lihat Demo" CTA reference accordingly. Added `#absensi` to AttendanceHighlight and `#whatsapp` to WhatsappHighlight.

- a2f8a1f: Loyalty earn mode: linear (current) + per_step (new).

  Until now the only earn shape was linear: N points per Rp spent. Tenants who run loyalty-card-stamp programs ("750 pt for every full Rp 15.000 spent") had no way to model that — they'd either lose precision (set rate=0.05 and have it diverge from the stamp count) or skip loyalty entirely.

  Add a `per_step` mode that earns `step_points` for every full multiple of `step_amount` spent:

  - linear → `floor(spend × earnRate)`
  - per_step → `floor(spend / stepAmount) × stepPoints`

  Both modes floor — Rp 14.999 on a "750 per Rp 15.000" config gives 0 pts; Rp 30.000 gives 1500.

  Schema: three new columns on `pos_settings` — `loyalty_earn_mode` (default `linear`), `loyalty_earn_step_amount`, `loyalty_earn_step_points` — plus a CHECK constraint on the mode. Existing tenants stay on linear with zero behaviour change.

  Settings page gets a Linear / Per kelipatan toggle that swaps the editable fields, with a live preview ("Belanja Rp 30.000 → 1500 poin (2 kelipatan)") so the owner sanity-checks before saving. Server's `computeLoyaltyEarn` helper dispatches the math from a single place — both the cold path in `createSale` and the redeem-aware re-compute under tx call into it.

- a2f8a1f: Fix M2 issues caught in audit of JUR-25 → JUR-31:

  - **BullMQ queue names** (JUR-29): rename `wa:send` / `wa:incoming` / `ai:reply` → `wa-send` / `wa-incoming` / `ai-reply`. BullMQ rejects names containing `:` because Redis uses that as its key separator; original spec & implementation crashed at boot with "Queue name cannot contain :".
  - **Baileys QR rendering** (JUR-26): the connection handler was wrapping the raw Baileys pairing payload string (e.g. `2@xxx,yyy,...`) in a `data:image/png;base64,` prefix. That payload isn't a PNG — the resulting data URL rendered as a broken image in the browser. Now uses the `qrcode` lib to actually generate a 256×256 PNG data URL.
  - **Baileys cleanup** (JUR-26): `socket.ev.removeAllListeners()` requires an event key on Baileys' typed emitter. Explicitly drop the three listeners we attached (`creds.update`, `connection.update`, `messages.upsert`).
  - **Final-failure detection** (JUR-29): replaced `override async onFailed(...)` (a no-op — `WorkerHost` doesn't expose that hook) with `@OnWorkerEvent('failed')`, gated on `attemptsMade >= job.opts.attempts` so we only mark messages `failed` after all retries are exhausted.
  - **Web typecheck** (JUR-31): missing `Warehouse` icon import in `lib/constants.ts`, `Dialog` was called with `onOpenChange` (it expects `onClose`), `ConfirmDialog` was called with `confirmLabel` (it expects `confirmText`) — corrected all three and added `variant="danger"` on the delete confirmation since it's a destructive action.

  End-to-end smoke verified: api boots cleanly, all 11 routes mapped, `/v1/wa/instances` returns 401 without auth.

- a2f8a1f: `<MaterialCombobox>` dropdown panel no longer collapses to the narrow item/bahan column width — it now opens at a fixed 24rem (~384px), capped at viewport-2rem on mobile. Material names and `@ Rp x/unit` suffixes fit without truncation on the Hitung HPP calculator table.
- a2f8a1f: Move the per-member branch-access editor out of the inline-popover chip on the members table and into the existing `EditProfileSheet` (the slide-in details panel triggered by clicking a row). The cramped popover anchored to the table cell was hard to use on narrow viewports; the sheet has room to breathe.

  The table cell is now display-only (chip with branch name or count + tooltip listing all assigned branches). All editing — name, photo, _and_ branch access — happens in one place. The sheet saves profile + branch changes together; branch update only fires when the picker draft actually differs from the saved state so the common "renamed the phone number" path stays a single write.

  No backend changes; reuses the existing `setTenantMemberBranches` server fn and `BranchAccessPicker` component.

- a2f8a1f: Expose ~150 server functions to the mobile app via `/api/mobile/<fn>` so every tenant-side screen can run natively without webviews or web fallbacks.

  New mobile gateway endpoints span HPP, POS (sale detail, cash sessions, promos, loyalty, settings, prep-waste, billing), inventory (movements, PO CRUD, HPP import), attendance (settings, shifts, QR host, billing), cashflow (entries, accounts, transfers, AR/AP), WhatsApp (instances + messaging), booking (calendar + queue + settings), site (publish + analytics + maintenance), master data (branches/suppliers/categories/customers), settings (account password, announcements admin, members + roles), referrals, onboarding, and creative (Konten/Studio/Logo/Spanduk).

  No behaviour change for the web app — every fn was already permission-gated on the server and the gateway just forwards requests with the JWT + tenant header.

- a2f8a1f: Add a notifications system covering in-app bell-icon delivery and native browser push (Web Push API + service worker). Sources: trial granted/expiring/expired, payment received/refunded, subscription expiring 7d/1d, clock-in/clock-out reminders (tenant-wide config in /attendance/settings — N minutes before OR after the scheduled time), and an admin broadcast page at /admin/notifications targeting all tenants, specific tenants, by role, or by module subscription. Uses an in-process node-cron tick (no separate worker) with idempotent inserts via a partial unique index on (user_id, type, source_key).
- a2f8a1f: POS Peti Kas: per-outlet override UI for the stale cash-session rule
  (#216 follow-up).

  The "Sesi Kas Kedaluwarsa" editor now has a per-branch scope picker that
  mirrors the existing receipt-override UX:

  - **Default (semua cabang)** edits the tenant rule — applies to every
    outlet that hasn't overridden, present and future.
  - A specific **Cabang** either follows the default (`Ikuti pengaturan
default`, which clears `branches.cash_stale_config` to NULL) or sets
    its own (`Atur sendiri untuk cabang ini`).

  Single-branch tenants never see the picker. New outlets start on inherit
  automatically. The tenant-only kill-switch + variance threshold stay in
  the separate "Peti Kas" card. Backend (`updateBranchCashStaleConfig`,
  the nullable `branches.cash_stale_config` column, and per-branch
  resolution in `getCurrentOpenSession`) already shipped — this wires the
  form to it; no schema change.

- a2f8a1f: Add platform admin foundation: `platform_admins` table, `requirePlatformAdmin` middleware, `/admin` route area (tenant list, tenant detail, platform-admin management), and conditional "Panel Admin" link in the user sidebar. Bootstrap the first admin via Supabase SQL editor; subsequent admins are added through the `/admin/platform-admins` UI.
- a2f8a1f: Fix `/pos/cashier` product grid not scrolling when many items present.

  The cashier page has a fixed outer height (`h-[calc(100vh-8rem)]`) and `CashierProductGrid` opens with `flex h-full flex-col` expecting that height to flow down. But the two intermediate wrappers (`<div className={'flex-1 lg:basis-[60%]'}>` and its child `<div className="flex w-full flex-col">`) lacked `min-h-0` and `h-full` / `flex-col`, so flexbox children defaulted to their content size instead of shrinking to fit. The grid grew taller than the viewport; the internal `overflow-y-auto` had no bounded parent, so no scrollbar appeared.

  Added `min-h-0 flex-col` to both intermediate wrappers (and the matching cart wrapper for symmetry), and `h-full w-full min-h-0 flex-col` to the direct parents of `CashierProductGrid` and `CashierCart`. Same fix applied to the cart side so long line lists scroll independently of the product grid.

  Pre-existing bug, surfaced after JUR-182 increased the typical item count in test tenants.

- a2f8a1f: POS multi-tax: each tenant configures any number of tax lines.

  Until now Pengaturan Kasir had a single tax row labeled PPN. Restaurant tenants (PB1 + service charge) and shops outside the standard PPN model had no way to express their actual tax stack — they'd either lose tax on the receipt or hand-do the math.

  Replace the single `(tax_enabled, tax_percent, tax_label)` triplet on `pos_settings` with a `taxes JSONB` array of `{label, percent, active}` rows:

  - **Settings page** swaps the single Pajak section for a list editor: Tambah baris, label + percent + active toggle, hapus
  - **Cashier breakdown** renders one row per active tax line ("PPN 11%" + "PB1 10%")
  - **Receipt** (thermal + A4) renders each tax line separately — pre-multi-tax sales fall back to the legacy single label
  - **Per-sale snapshot**: new `pos_sales.tax_lines` JSONB stores `{label, percent, amount}` per row at sale time so retro tax-rate edits don't rewrite history. Singular `tax_amount` column stays as the SUM (back-compat with reports + receipt total).
  - **Math**: each tax applies independently to the post-discount, post-promo, post-redeem subtotal. No cumulative stacking (PB1-on-top-of-service-charge); if you need that model say the word and I'll add it.

  Migration `0029_pos_multi_tax.sql` seeds the new array from each tenant's existing single-tax columns and adds the `tax_lines` snapshot column to `pos_sales`. Old scalar columns kept for one release as a fallback in case we need to revert.

- a2f8a1f: Two role-tuning changes around Kasir, building on the prior commit that gave Kasir `pos.read` for `/pos/sales` history:

  1. **New `pos.report.view` permission** splits the gate on `/pos/reports` (Laporan + Prep Waste) away from the overloaded `pos.read`. Granted to Owner / Admin / Pemilik Outlet / Supervisor; intentionally not granted to Kasir or Staff. Wired as the gate on the sidebar entry (`constants.ts`), the route `beforeLoad`, `getPOSReport`, and `getPrepWasteReport`. `pos.report.profit` remains the inner sub-gate for HPP / Untung kotor / Margin cards. Net effect: Kasir keeps history visibility, loses Laporan visibility.

  2. **`canVoidSale` lowered from `pos.manage` to `pos.transact`.** Cashiers — the role most likely to spot a payment-method mistake mid-shift — can now cancel same-day sales without bouncing the customer back to the owner. The server-side same-day rule in `voidSale` is the real abuse guardrail (past-day refunds still require admin intervention), and an explicit `pos.transact` check was added to `voidSale` as defence in depth.

  Prod state already updated: `pos.report.view` permission row inserted, role mappings added for Owner / Admin / Pemilik Outlet / Supervisor (idempotent SQL because the `seed:rbac` script still hits the unrelated `ON CONFLICT` constraint issue).

- a2f8a1f: POS reports page (`/pos/reports`) gets three connected upgrades:

  1. **Profit gating with a new `pos.report.profit` permission.** The page now requires `pos.read` at both the route-level `beforeLoad` and inside `getPOSReport` (closes a gap where a `pos.transact`-only cashier could hit the URL directly). HPP (modal) / Untung kotor / Margin % cards are sub-gated on a new `pos.report.profit` permission so a Supervisor with `pos.read` still sees revenue and transaction counts but not the cost-side numbers; Owner / Admin / Pemilik Outlet keep full visibility (they auto-receive the new perm via their `all` / `all-except-settings-manage` / explicit templates). CSV + PDF exports skip the cost rows when the caller lacks the perm, and the server zeros out the values as defense in depth so an API spelunker can't pull them.
  2. **Configurable void categories per tenant.** New `pos_void_categories` table (system-default + tenant-custom rows) plus a nullable `void_category_id` on `pos_sales`. Five system defaults are seeded lazily per tenant on first read (Ganti metode bayar, Salah input, Pelanggan batal, Item tidak tersedia, Lainnya). The void modal on the sale detail page now requires a category pick above the existing free-text "Alasan" note, and a new "Kategori Pembatalan Transaksi" section under `/pos/settings` lets the owner add custom categories and archive (not delete) any unused row. The reports page renders an "Alasan Pembatalan" breakdown with per-category count + share of total voids; rows without a category bucket as "Tanpa kategori".
  3. **Peti Kas at-a-glance tiles** (Sesi dibuka, Selisih, Setor tunai, Tarik tunai) on the report for the selected date range, with a "Lihat detail" link to `/pos/cash-sessions`. Hidden when zero sessions opened in the window so non-cash tenants don't see a strip of zeros.

  Migrations: `0122_pos_void_categories.sql` (new table + nullable column on `pos_sales`). The new `pos.report.profit` permission row + its role mappings (Owner / Admin / Pemilik Outlet) have already been seeded directly on the prod database — the `seed-rbac` script has an unrelated pre-existing `ON CONFLICT` constraint issue that prevents a full re-run, so the mappings were inserted via idempotent SQL. Fresh environments that successfully run `seed:rbac` will pick the perm up via the standard flow.

- a2f8a1f: POS surface now respects the per-branch POS toggle. Previously a branch toggled off for the POS module (e.g. a gudang / warehouse, or a tenant's "Pusat" used only for stok + HR) still appeared in the cashier branch picker, and once selected the tenant-level POS feature flags (promo, stamp, loyalty) lit up for it — because feature gating was driven by tenant `pos_tier`, not by the per-branch `enabled_modules` toggle. Sales recorded under such a branch flowed through `createSale` without complaint.

  Two-layer fix:

  1. `getPOSCashierMasters` now filters its branch list with `'pos' = ANY(enabled_modules)`, so the cashier picker only ever surfaces POS-enabled branches.
  2. `assertBranchAllowedForTier` adds an unconditional POS-toggle check (runs on every tier including unlimited Komplit) plus filters the tier-cap "first N branches by createdAt" slice by the same predicate. `createSale` therefore rejects a sale addressed to a non-POS branch with _"Cabang ini belum mengaktifkan modul POS. Aktifkan dari Data Master → Cabang."_

  `voidSale`, `listSales`, and the reports endpoints intentionally don't gain the check — they operate on already-created rows, so a tenant who previously rang sales against a non-POS branch (Es Teh Paus Pusat had 7 such sales before this fix landed) can still see them in history and void them if needed. Behaviour change: a tenant who forgets to tick POS on a new outlet now sees a clean error instead of silent sales going through; the fix is one click in `/master/branches`.

- a2f8a1f: POS promos: optional banner image, attached automatically to the
  WhatsApp AI's reply when it mentions the matching promo.

  - DB: new `tenant_promotions.image_key` (nullable text). Migration 0051. Idempotent.
  - S3: `uploadPromoImage` / `getPromoImageSignedUrl` / `deletePromoImage`
    helpers — tag `kind=promo` so the wa-media 24h lifecycle skips it.
    Path `<tenantId>/promos/<promoId>.<ext>`.
  - POS promo CRUD (`/pos/promos`): file picker on the create/edit
    Sheet, signed thumbnail in the list, "remove image" affordance.
    Image side-effects run AFTER the row write so a half-saved image
    never wipes the underlying promo data.
  - Go RAG retriever: promo snippet now carries one `Attachment` per
    active promo with an image (name + S3 key).
  - Go AI reply path (`ai_reply.go`): after the AI generates text, scan
    the reply for any promo name from `Attachments` (case-insensitive
    substring), create an outbound `wa_messages` row with `media_key`
    set to the promo image, and enqueue `wa:send_image`. Customer gets
    the banner right after the text. De-duplicates by image key so the
    same banner isn't sent twice.

  Failure-mode notes: image enqueue failures are logged but never
  abort the text reply (text already shipped); fuzzy-match is
  deliberately loose because promo names are usually distinctive
  ("HEMAT20", "Diskon Lebaran") rather than common Indonesian words.

- a2f8a1f: Finish the public tenant site: robots.txt / sitemap.xml, failure fallback, image perf (JUR-188 + JUR-189).

  - **robots.txt / sitemap.xml** — new per-subdomain server routes. A published tenant site is crawlable and advertises its sitemap; a draft / maintenance / unclaimed subdomain is `Disallow: /` and its sitemap 404s, so half-built sites never get indexed.
  - **Failure handling** — a claimed tenant subdomain whose data fetch fails now renders a calm branded "Situs sedang gangguan" page instead of a raw 500.
  - **Performance** — below-the-fold section images (`about`) lazy-load; the hero's first slide loads eagerly with a high fetch-priority hint while later carousel slides defer.

- a2f8a1f: Add SEO + edge caching to the public tenant site (JUR-177, part 1).

  A claimed `{slug}.vintra.my.id` already renders the tenant's published site, but its `<head>` only carried a title and the HTML was never edge-cached. This adds:

  - Per-tenant `<title>`, meta description, Open Graph + Twitter card tags from the published `settings.seo`, plus a `LocalBusiness` JSON-LD block. Unpublished / maintenance sites emit `robots: noindex`.
  - Published tenant pages send `Cache-Control: s-maxage=300, stale-while-revalidate=600` so Cloudflare edge-caches them for 5 minutes. Publishing or toggling maintenance fires a best-effort Cloudflare cache purge so edits appear immediately. New env: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ZONE_ID` (purge is a logged no-op when unset).

  The remaining JUR-177 scope — per-tenant robots.txt / sitemap.xml and a performance pass — is tracked as follow-ups.

- a2f8a1f: QA fixes from end-to-end Mantra Maker pass.

  **`/help/$slug` showed help index, not the article.** `help.tsx` was a leaf route without `<Outlet />`, so the child slug route was unreachable. Renamed to `help.index.tsx` so the two route files become siblings under `/help/`.

  **Cashier preview total ignored promo + loyalty redeem.** Cart breakdown showed correct numbers but the payment modal + success modal showed pre-promo, pre-redeem totals — cashier was over-collecting cash. Pulled the math into a shared `computeCartTotals` helper used by both the cart and the parent route, plus wired a debounced `validatePromoCode` query so the promo amount appears in the breakdown the moment the cashier types a valid code.

  **Dashboard "Modul" cards showed Segera Hadir for shipped modules.** POS and Inventory cards were hardcoded as locked, even for tenants on Toko / Komplit. Now they read live tier from `moduleSubscriptions` and show Aktif / Trial / Free badges. Finance stays Segera Hadir until that module ships.

  **`/pos/reports` Ringkasan was missing Promo total.** `getPOSReport` summary aggregated line discount, sale discount, tax and loyalty redeem but skipped `promo_amount`. Owners using promo codes had no way to see how much they were spending on promo discounts. Added `promoTotal` to the SQL aggregation, the JSON response, the Ringkasan card, and CSV + PDF exports.

  **Sale counter started at JQU-YYYY-00000 instead of 00001.** First-ever sale per tenant got seq 0 because the upsert inserted `next_seq=1` without bumping, then read it back unchanged. Rewrote so the INSERT branch seeds `next_seq=2` (we use 1, next sale uses 2) and `RETURNING (next_seq - 1)` gives the just-used number for both INSERT and UPDATE branches. Existing tenants are unaffected — their counters keep incrementing forward correctly.

- a2f8a1f: Add DB-backed RBAC system: global `roles`, `permissions`, `role_permissions` tables; `tenant_members.role_id` FK; `seed:rbac` script seeding default roles (owner, admin, supervisor, staff, cashier) and 18 action-level permissions; `requirePermission()` middleware helper; admin pages for managing roles + permissions; tenant owner self-serve member invite + role assignment at `/settings/members`.
- a2f8a1f: JUR-10 service-mode: recipe-backed inventory items have no own stock balance.

  Closing the loop on the JUR-10 entry-point landed earlier — once a tenant linked an inventory item to an HPP product, the model still treated it like a stocked item. Selling 5 cups of "Teh Original" wrote 5 stock-out movements against the item's own balance (pushing it negative), even though the BOM walker was already deducting Gula / Air / Teh Tubruk from the ingredient items. Cashier grid showed "Stok: 0 / Habis" for items that should have been "Auto".

  This pass treats any inventory item with `linkedHppProductId` as **service-mode**:

  - **`createSale`** skips the item-level out movement for service items (BOM walker still runs).
  - **`voidSale`** correspondingly skips the compensating in movement (no out → no in).
  - **`listPOSProducts`** surfaces a `recipeBacked` flag.
  - **Cashier grid** shows "Auto" badge instead of "Stok: N", drops the out-of-stock disable, drops the qty cap.
  - **`recordMovement`** rejects manual stock-in/out/adjust for service items with a friendly Indonesian error pointing the cashier at the bahan instead. POS-driven movements with `referenceType='pos_sale'` still allowed.
  - **Stock-movement form** filters service items out of the picker upstream so the user never gets the rejection toast.
  - **Inventory items list** shows a "Resep" pill + "Auto dari bahan" right-rail instead of a stock count.

  Filed [JUR-15](https://linear.app/vintra/issue/JUR-15) for batch-prep mode (the alternative model where ingredients are deducted at prep time and the cashier sees "Siap: N"). Service-mode is correct for the dominant cafe/warung flow; batch-prep is for kitchens that bulk-produce in the morning.

- a2f8a1f: Give the admin referral pages their own sidebar section.

  The referral admin pages were split between a "Modul" section (config, claims) and no entry at all (the new access audit page). They now live under a dedicated "Referral" section — Akses, Klaim, Konfigurasi — so the access allowlist page is discoverable.

  The global config page is also reframed: now that caps are per-tenant, its `capPct` field is relabelled as the default cap pre-filled when enabling a new tenant (not a globally enforced limit), and the stale "lowering the cap" warning is removed since lowering a new-tenant default has no retroactive effect.

- a2f8a1f: Make the referral program an admin-curated allowlist with per-tenant caps.

  Previously every tenant could create referral codes, all sharing one global cap. The program is now curated: a tenant can run a referral program (create codes, view pendaftar, claim commissions) only when a platform admin has enabled it, and each enabled tenant gets its own discount + commission cap.

  - New `tenant_referral_settings` table (`enabled` + `cap_pct` per tenant). Seeded with Mantra Maker and DigitalContent (the two tenants with existing codes), both at a 20% cap.
  - New `requireReferralAccess` middleware gates all tenant-facing referral server functions; `getReferralCap` and code create/update now use the per-tenant cap instead of the global one.
  - Off-allowlist tenants no longer see the Referral sidebar entry, and a direct hit to `/referrals` redirects to the dashboard.
  - Admin can toggle access + set the cap on a new "Akses Referral" card on the tenant detail page; a read-only `/admin/referrals/access` page audits every tenant's status.
  - Disabling a tenant freezes their referral codes (`is_active = false`); existing attributions and commissions are grandfathered so referees keep their discount and the referrer keeps earning through the attribution window.
  - Being referred (signing up with someone else's code) stays universal — the allowlist only controls who can run a program, not who can be referred.

- a2f8a1f: Fix referral page table headers: route through proper i18n keys instead
  of hardcoded Indonesian. Adds a `referrals` namespace
  (`colCode` / `colLabel` / `colDiscount` / `colCommission` /
  `colAttributions` / `colStatus`) plus `common.actions` (reusable
  across other tables that need it), and renders all column headers
  - the Edit aria-label via `t()`.
- a2f8a1f: Referral program upgrades:

  - Optional per-code max-claims cap. Owners can set a usage limit (e.g.
    1000); once reached, the public validator returns quota-exhausted
    and the register form shows "kuota penuh" instead of "valid". The
    attribution writer uses an atomic INSERT … WHERE … COUNT(\*) <
    max_claims so concurrent signups can't push past the cap.
  - Share dialog on the /referrals page. Each code now has a Share
    button that opens a dialog with the full share URL
    (`<origin>/?ref=CODE`), one-click copy, deep links to WhatsApp /
    Telegram / Facebook with a pre-filled Indonesian message, and the
    native Web Share sheet on mobile.

- a2f8a1f: Referral epic — admin-side polish from e2e testing feedback.

  - **WA pricing alignment**: both `WaPaymentSheet` and the local
    `WaPaymentSheet` in `/admin/finance` now hardcode 49k Basic / 149k
    Komplit (Enterprise dropped — `is_active=false` in the
    `wa_subscription_plans` DB seed). Matches the tenant-facing
    `/whatsapp/billing.tsx` and the DB row. The `recordWaPayment`
    server fn enum was tightened to `'basic' | 'komplit'` so a stale
    Enterprise post is rejected client + server side.
  - **Tenant-detail referral banner**: a green "🎁 Pendaftar referral
    — diskon X%" banner now renders at the top of
    `/admin/tenants/$tenantId` whenever the tenant signed up via a
    referral code AND the 12-month window is still open. Surfaces the
    attribution before the admin clicks any module-activation button.
  - **WA activation sheet discount math**: when the tenant has an
    active referral attribution, the sheet shows a green
    attribution-info banner, line-through original price, discounted
    total, and "Hemat Rp X (Y%)" annotation. The submitted
    `amountIdr` is the discounted figure, so `financial_transactions`
    - the auto-credit commission both reflect the actual paid amount.
  - **Window respected**: the new `adminGetTenantReferralAttribution`
    server fn filters `windowEndsAt > now()`, so once the 12-month
    attribution window elapses the banner disappears and the discount
    stops applying. (Commission credit already had the same check via
    `creditReferralCommissionIfApplicable`.)
  - **Submit-claim dialog UX**: auto-close the confirmation dialog on
    error so the user can retry without having to manually dismiss
    the stuck modal first.

  POS / Inventory / Attendance payment sheets need the same treatment
  — filed as a follow-up.

- a2f8a1f: Remove the NestJS `apps/api` ahead of the Go rewrite.

  The api will be re-implemented in Go + whatsmeow + Fiber + asynq for resource efficiency (~30% RAM reduction at idle), whatsmeow's superior protocol stability vs Baileys, and single-binary deploy ergonomics. See Linear JUR-60 through JUR-69 for the Go-flavored M1+M2 tickets.

  Also drops the `api:*` scripts from the root `package.json` and the `vintra-api` entry from `ecosystem.config.cjs` (the Go api will use systemd on its own VPS, not PM2 — see JUR-46).

- a2f8a1f: Scaffold `apps/api` as a Go service (JUR-60, M1 Foundation).

  Fresh Go workspace replacing the previously-removed NestJS api. Boots a Fiber HTTP server on `:4000` with `/v1` prefix, structured `slog` output, panic recovery, JSON 404 fallback, and graceful shutdown on SIGINT/SIGTERM. No external dependencies required to run — config defaults make `make dev` work on a fresh laptop.

  Layout:

  ```
  apps/api/
  ├── go.mod                  // github.com/kriptonhaz/vintra/apps/api
  ├── Makefile                // make dev / build / run / tidy / test / vet / clean
  ├── .air.toml               // hot reload config
  ├── .env.example            // documented env contract (most vars added in JUR-61/62/33)
  ├── .gitignore              // tmp/, bin/, data/, *.db, .env
  ├── cmd/api/main.go         // bootstrap: dotenv → config → slog → fiber → listen → graceful shutdown
  └── internal/
      ├── config/config.go    // caarlos0/env-backed Config with safe defaults
      └── http/server.go      // Fiber app builder, /v1/ping smoke route, JSON 404
  ```

  Locally verified: `go vet ./...` clean, `go build ./...` clean, `make run` listens on `:4000`, `curl /v1/ping` returns `{"ok":true,...}`, unknown paths return JSON 404 with the requested path echoed.

  Subsequent Go tickets layer on top: JUR-69 (full env contract), JUR-61 (pgx + sqlc + go-redis), JUR-62 (Supabase JWT middleware + tenant context), JUR-63→68 (M2 WhatsApp), JUR-33→39 (M3 AI).

- a2f8a1f: Scaffold `apps/api` — new NestJS service for WhatsApp + AI automation (JUR-19, M1 Foundation of WhatsApp AI Backend project).

  Adds a workspace member `@vintra/api` running NestJS 11 on the Fastify adapter, with the dependency surface for the rest of M1/M2 already wired in (`@nestjs/bullmq`, `bullmq`, `ioredis`, `@whiskeysockets/baileys`, `@supabase/supabase-js`, `pino`, `zod`). Standalone CommonJS tsconfig (NestJS doesn't tolerate the bundler-targeted base config). Boots cleanly on `PORT || 4000` with `/v1` global prefix; returns 404 on unmatched routes — verified locally via `bun run api:build && PORT=4099 node apps/api/dist/main.js`.

  No production deploy yet — `apps/api` isn't in `ecosystem.config.cjs`. PM2 changes come in JUR-46.

- a2f8a1f: POS Peti Kas: Setor Tunai (`drop`) now **adds** cash to the drawer instead of deducting it. The previous behaviour modelled "setor" as "cash handed up to the safe/owner" (an outflow), which contradicted how merchants cashiers actually use the action — topping up the float, returning unused change from a purchase, etc. Tarik Tunai (`payout`) stays as the outflow side.

  Changes:

  - `insertCashMovement` now bumps `cash_in_total` for `'drop'` (alongside `'sale'`); refund + payout keep bumping `cash_out_total`.
  - `closeCashSession` aggregation sums `'drop'` into the cash-in side.
  - Tutup Kas modal: expected = opening + cashSales + drops − refunds − payouts; Setor row now renders as a `+amount`.
  - Cash sessions detail view colours `'drop'` rows as inflows.
  - ID/EN copy + docstrings updated to describe putting cash INTO the drawer.

  Impact on existing data: 1 row tenant-wide at the time of this change (an already-closed test session whose stored expected/actual/variance snapshot is left untouched). Future drops will now behave correctly.

- a2f8a1f: Fix the sidebar highlighting two menu items at once.

  Katalog Produk, Bahan Baku, and Daftar Stok all point at `/inventory/items`, distinguished only by `?view=`. Daftar Stok has no `?view=` pin, and the old per-child matching treated a no-search child as a match for any URL on that pathname — so navigating to Bahan Baku (`?view=ingredients`) also lit up Daftar Stok. Active-child resolution now runs once across the whole nav tree and picks the most specific match, so a no-search child only highlights when no search-pinned cousin matches.

- a2f8a1f: Fix the wrong sidebar parent menu auto-expanding.

  On `/inventory/items?view=ingredients` the Inventaris menu auto-expanded instead of Produk. `moduleScore` picks the active module by URL prefix, and the Produk parent pins `?view=sellable` as its default — so on the `ingredients` view Produk failed to match and Inventaris (`/inventory`, a loose prefix of `/inventory/items`) won. Module selection now follows the resolved active child: whichever parent owns the active child wins, so Produk activates and expands when Bahan Baku is open. The prefix-based scoring stays as a fallback for URLs that don't land on a declared child.

- a2f8a1f: Sidebar: chevron toggles expand without navigating.

  Original tree behaviour required navigating to a module just to see its children — bad on mobile, where opening "Pengaturan" inside Absensi meant tapping Absensi (loads dashboard), waiting for the route to change, then tapping the now-revealed child. Two unnecessary roundtrips per quick lookup.

  Split the row into two click targets: the icon + label still navigates to the module home, the chevron toggles expand only. Cashier can now peek at any module's sub-pages from anywhere without leaving the current page. Active module stays auto-expanded on URL match (no behaviour change there); manual chevron toggles persist within the session.

- a2f8a1f: Hide the sidebar scrollbar. The nav still scrolls when its items overflow, but the always-visible gutter (from `overflow-y-auto`) was visually noisy and ate a few pixels of horizontal space. Added a `scrollbar-none` Tailwind utility (Firefox `scrollbar-width: none` + WebKit `::-webkit-scrollbar { display: none }`) and applied it to the sidebar nav.
- a2f8a1f: Add `/inventory/items` (Daftar Stok) as a child link under Inventaris in the sidebar. Previously this route was only reachable via the Produk section's filtered views (`?view=sellable` / `?view=ingredients`); the unfiltered all-items view had no nav entry.
- a2f8a1f: Sidebar IA: split "Stok Barang" into Produk + Inventaris (Qasir-style).

  Combining sellable POS items, raw ingredients, and operational stock movements under a single "Stok Barang" menu was confusing — the cashier wanted to find their sellable catalog and instead waded through ingredient SKUs and PO history.

  Two new top-level menus replace it:

  **📦 Produk**

  - Katalog Produk → `/inventory/items?view=sellable`
  - Bahan Baku → `/inventory/items?view=ingredients`

  Both children render the same page filtered by `is_sellable`. Page title + subtitle adapt accordingly ("Katalog Produk / Item yang muncul di kasir POS untuk dijual" vs "Bahan Baku / Bahan baku & ingredient — tidak muncul di kasir, dipakai untuk hitung HPP & resep").

  **🚚 Inventaris**

  - Ringkasan → `/inventory`
  - Pembelian → `/inventory/po`
  - Penyesuaian Stok → `/inventory/movements`
  - Tagihan → `/inventory/billing`

  (HPP Calculator stays as its own top-level menu, per request.)

  Plumbing changes to make the search-param children work:

  - `NavItem` + `ChildNavItem` gain optional `search?: Record<string, string>` so multiple children can share a pathname distinguished by `?key=value`. TanStack `<Link>` consumes them as a separate prop.
  - Sidebar's child active-state highlights only when both pathname AND every required search param match.
  - `ModuleBreadcrumb` scores matches across both pathname and search so a `/inventory/items?view=sellable` URL renders "Produk → Katalog Produk" instead of "Inventaris → Item".

  Old "Stok Barang" label removed from the sidebar; `nav.inventory` translation key kept for back-compat with anything else still referencing it.

- a2f8a1f: Sidebar: every module nests its sub-pages directly under it.

  Until now each module had its own tab strip — `POSSubnav`, `AttendanceSubnav`, `InventorySubnav`, the inline `HppNav` — that the user had to click into the module first to even see. The owner couldn't jump straight from the home dashboard to "Absensi → Setting" or "POS Kasir → Promo"; they had to land on the module home, find the right tab, then click again.

  Replace that pattern with an expandable sidebar tree. Modules with sub-pages get a chevron and auto-expand whenever the URL is anywhere under them; siblings stay collapsed so the sidebar doesn't sprawl. Click the parent and the row both navigates to the module home AND opens its children.

  Single source of truth: `MODULE_NAV` carries `children: ChildNavItem[]` per module, with the same permission / feature / role gates the old subnavs ran. Pages keep a slim `<ModuleBreadcrumb />` at the top showing "Module → Page" — derived from the URL, no per-page wiring. Old subnav components deleted.

- a2f8a1f: JUR-176 follow-ups: analytics dashboard + services price fix.

  **Analytics** (`/site/analytics`):

  - New table `tenant_site_views` (migration 0067) — one row per page
    load, keyed by tenant + viewed_at + visitor_hash + path + referrer.
  - `recordSiteView` fires from both SSR entry points (subdomain
    index loader + `/q/$slug` loader), keyed off Cloudflare's
    `cf-connecting-ip` so refresh spam from one IP collapses to a
    single unique-visitor for the day. The 15-second polling client
    omits a new `track` flag on `getPublicQueueData` so polls don't
    inflate the visit count by 5760×.
  - Dashboard at `/site/analytics` with range picker (7/14/30/90d),
    three stat cards (today / range total / unique visitors), a
    CSS-only daily bar chart (no library), and a top-10 referrers
    list. Bucketed by Jakarta date.
  - Sidebar: new "Analitik" sub-entry under Situs.
  - Private `_tenantId` field stripped from the public renderer's
    response so anonymous visitors never see tenant ids.

  **Price fix**: services on the public site were showing Rp 0 because
  the Drizzle correlated subquery `${inventoryItems.id}` inside a
  `sql` template returned '0' instead of the outer-row reference.
  Replaced with a separate pricing query + JS merge — one extra
  roundtrip, zero subquery weirdness. Same fix in
  `getEditorPreviewData` (editor preview) and
  `fetchPublicQueueDataForSlug` (public renderer).

- a2f8a1f: JUR-176 follow-ups: hide booking duration on POS-only items + tax
  disclaimer.

  - Services data now carries `isBookable` per item. The Services
    section's "X menit" badge only renders when both the section's
    `showDuration` toggle is on AND the item is bookable AND duration
    > 0. POS-only items (instant noodles for waiting customers) no
    >    longer get a meaningless minute label.
  - `getEditorPreviewData` + `fetchPublicQueueDataForSlug` now fetch
    `pos_settings.taxes` and aggregate active rows into
    `{ totalPercent, labels }`. When at least one active tax exists,
    the Services section appends a footnote: _"Harga belum termasuk
    PPN + PB1 (21%)."_ (labels join with "+" so stacked taxes read
    naturally). Pure copy — doesn't recompute prices.
  - Per-item booking duration was already supported on the inventory
    schema + edit form (`/inventory/items` → click edit on a bookable
    item → "Durasi booking (menit)"). No code change needed; this
    surfaces it as discoverable via the renderer's new gating.

- a2f8a1f: Add a business logo upload to the Situs editor's Theme card. The logo is stored on the site theme and used as the marker icon in the Peta Lokasi section (falling back to the Vintra logo when none is set). Replacing the logo deletes the previous S3 object — guarded so the currently published logo survives until the next publish. Migrating v1 sites carry their old `logoAssetKey` into the v2 theme.
- a2f8a1f: JUR-176 follow-ups:

  - Services list on the public site no longer requires
    `is_bookable=true`. A jasa-only tenant (cuci motor) can now surface
    POS items (e.g. instant noodles for waiting customers) alongside
    their bookable services. Filter is now simply
    `is_sellable AND is_active`.
  - Wire S3 image upload for tenant-site assets:
    - `uploadTenantSiteAsset` / `getTenantSiteAssetSignedUrl` /
      `deleteTenantSiteAsset` / `parseTenantSiteAssetKey` helpers tagged
      `kind=tenant-site`. Key layout
      `{tenantId}/site/{kind}/{assetId}.{ext}`; single-slot kinds
      (logo/og) overwrite, gallery accumulates by uuid.
    - `uploadSiteAsset` server fn bridges the editor's `PhotoUploadField`
      to S3 — `booking.write` gated, parses data URLs, returns the key.
    - Public renderer pre-signs every image key declared by the
      published template's schema and ships the map in the response;
      editor preview signs the in-progress draft. Templates'
      `resolveAssetUrl()` is now a real lookup, not a placeholder.
  - Replace the "Coming Soon" placeholder in the editor's image field
    with the real `PhotoUploadField`, including client-side
    compression + immediate preview update via a local URL cache.

- a2f8a1f: JUR-176: maintenance mode (under-construction page) for tenant sites.

  - Migration 0068 adds `maintenance_mode boolean` (default false) +
    `maintenance_message text` to `tenant_sites`.
  - New `setSiteMaintenanceMode` server fn is **independent of the
    publish flow** — toggling on/off doesn't require re-publishing
    settings. The `published_settings` snapshot stays intact so
    flipping back to false instantly restores whatever was live.
  - Public read (`fetchPublicQueueDataForSlug`) checks the flag first
    and short-circuits to a `maintenance: { active, message, brandColor }`
    marker. No inventory / queue / branches / analytics work when the
    site is offline.
  - New `SiteMaintenancePage` component — branded centered page that
    picks up `published_settings.theme.brandColor` so the offline
    state still feels like the tenant's. Shows the custom message or
    a localized default.
  - Editor: new "Status Situs" card at the top with toggle + optional
    custom message textarea (saves on blur).

- a2f8a1f: Rebuild the public site "Peta Lokasi" section. It now pins branches from their stored coordinates, with two map providers the tenant can pick between: Leaflet + OpenStreetMap (all branches on one map, Vintra logo as a custom marker, no API key) or Google Maps (familiar keyless embed, single branch, no logo) — the editor shows the trade-off. A multi-select "Cabang yang ditampilkan" config picks any subset of branches (empty = all). Each branch also gets an address card with a one-tap Google Maps directions link, which doubles as the no-JS fallback. Adds a `branchMultiSelect` editor field type and surfaces branch latitude/longitude in the site render data.
- a2f8a1f: JUR-176 v2: section-builder rebuild.

  The tenant public site is now a list of modular sections the tenant
  can enable, disable, reorder, and configure individually — not a fixed
  template with predetermined slots.

  **New settings shape** `{ theme, sections[], seo }`:

  - `theme`: brand color + accent + font choice (Inter / Poppins / Lora / system)
  - `sections`: ordered list of `{ id, type, enabled, settings }`
  - `seo`: page title + description + OG image asset key

  **Ten section types**:

  - `hero` — three layouts (color-bg, image-bg full-bleed, split text-left/image-right) with configurable CTA
  - `about` — centered or side-by-side text + image
  - `services` — auto-pulled from inventory (grid or list), optional duration
  - `queue` — live antrian (auto-shows when booking mode = queue)
  - `branches` — multi-branch cards with Google Maps deeplinks
  - `hours` — per-day table, today highlighted in brand color
  - `maps` — Google Maps embed (URL or address; falls back to main branch)
  - `gallery` — image grid with repeater field (2/3/4 columns, captions)
  - `contact` — branded band with WhatsApp + phone + email + Instagram
  - `cta-banner` — mid-page CTA (brand-color band or outline-minimal)
  - `footer` — system-managed Vintra stamp (always last)

  **Editor UI**: vertical section list with toggle / up-arrow / down-arrow /
  expand-to-edit / delete. "+ Tambah Section" modal picker (searchable,
  hides already-added singletons). Theme card on top, SEO card at bottom.
  Preset picker ("Ganti Preset" button) with 6 starters: Mini, Warung
  Modern, Kafe/Resto, Toko Retail, Salon/Jasa, and new **Cuci Motor /
  Walk-in** preset. Confirm dialog before overwriting draft.

  **Modern visual polish**: generous padding (`py-16+`), proper typography
  hierarchy, brand color used as accents rather than flat fills, hover-
  lift cards, smooth transitions.

  **Backwards-compatible**: `normalizeSettingsV2()` accepts both shapes
  — old v1 flat keys are converted to v2 on the fly. No schema migration.
  Tenants without a published site fall back to the JUR-185 baseline
  queue page (no regression for the cuci motor customer already live at
  mantra.vintra.my.id).

- a2f8a1f: Add category grouping and numbered pagination to the public site "Layanan & Harga" section. Two new editor toggles: "Kelompokkan per kategori" renders products under category headings (pulled from inventory categories), and "Aktifkan halaman" splits a long catalog into numbered pages with a configurable items-per-page count. Both compose — a paginated slice still shows headings when the category changes within it.
- a2f8a1f: JUR-176: mobile polish + template feedback round 2.

  **Hero**:

  - Carousel: `heroImages` repeater (max 3) replaces the single
    `heroImageAssetKey`. New `carouselAutoSlide` toggle and
    `carouselDurationSec` select (3/5/7/10s). Cross-fade transitions
    with click-dots. Backwards-compat in the normalizer: the old
    single-image key auto-promotes to `heroImages[0]` so existing
    tenants don't lose their photo.
  - CTA button now always renders when `ctaText` is non-empty (was
    hidden when href couldn't resolve, e.g. WA action + empty number).
    Falls back to `'#'` href instead of vanishing.

  **Services**:

  - New `gridColumns` select (2/3/4 desktop, mobile stays 2) —
    matches the gallery section's UX. Desktop breakpoints widened to
    `lg:` / `xl:` so the narrow editor preview shows mobile-2-col
    truthfully (vs. the live full-width page hitting 3 or 4 cols).
  - New `priceFormat` select: 'full' (`Rp 25.000`) or 'short'
    (`Rp 25K`). Compact `formatRupiahShort` helper added — values
    ≥1JT use "JT" suffix.
  - Cards are now `@container` (Tailwind v4 native container queries).
    Text scales with card width, not viewport. Short-format prices
    scale larger than full-format at the same card width because the
    shorter string has visual room.
  - `whitespace-nowrap` on prices, `overflow-wrap: anywhere` on names
    — no more "Rp / 4K" stacking or word-per-line wraps in tight
    cards.

  **Queue**:

  - Editor-only empty-state hint: when the section is enabled but
    the tenant's mode isn't 'queue' OR there are no active resources,
    the editor preview shows an amber dashed-border explainer
    pointing to `/booking/settings`. Public visitors still get
    silent return (no empty card). Driven by new `isEditorPreview`
    flag on `SectionRenderProps`.

  **Branches**:

  - Grid now `grid-cols-1 md:grid-cols-2 lg:grid-cols-3` (was
    `sm:grid-cols-2` which crushed cards on common phone widths).
  - `flex-wrap` on the heading row so the "Utama" badge falls to a
    second line instead of clipping behind the name.
  - `break-words` on long addresses.

  **Mobile audit (all sections)**:

  - Tightened padding (`py-12 sm:py-16 lg:py-20`), heading sizes
    (`text-2xl sm:text-3xl lg:text-4xl`), and gap spacing
    (`gap-3 sm:gap-4`) across hero, about, services, queue, branches,
    hours, maps, gallery, contact, cta-banner.
  - Maps iframe height now responsive (320 → 400 → 480px).
  - Gallery 2-col on mobile (was 1-col).

- a2f8a1f: Split deploy: web + api on separate servers (JUR-46).

  The api (NestJS + Baileys) runs on a separate VPS from the web app — failure isolation, different resource profiles (web stateless, api stateful with one Baileys socket per tenant), and independent deploy cadence (a web hotfix shouldn't restart all live WhatsApp sockets and force every tenant to rescan QR).

  - **`deploy.sh`** is now target-aware: `./deploy.sh web` (legacy default), `./deploy.sh api`. Per-target config via env vars (`WEB_SERVER_IP` / `API_SERVER_IP` / etc.) with sensible defaults for the existing prod web setup. The api path skips the build step entirely (Bun runs `apps/api/src/main.ts` directly) and rsyncs full source for `apps/api`, `packages/db`, `packages/shared`.
  - **`ecosystem.config.cjs`** gains a `vintra-api` app entry (Bun interpreter, port 4000, max_memory_restart 900M, single instance — Baileys is stateful). The same file ships to both servers; each starts only its own app via `pm2 start ecosystem.config.cjs --only <name>`.

  The api VPS itself isn't provisioned yet — that's tracked in JUR-58. Once the box exists with Bun + PM2 + Redis (JUR-47) installed, `API_SERVER_IP=… ./deploy.sh api` will work end-to-end.

  Auth across the two servers is already correct: web's server functions forward the Supabase JWT as `Authorization: Bearer` to the api (`apps/web/src/server/functions/whatsapp.ts:15-34`), and the api's `SupabaseJwtGuard` verifies against the same Supabase project. No CORS, no cookie sharing, no DNS gymnastics required.

- a2f8a1f: Fix: /whatsapp/$id silently rendered NotPairedGate when the instance UUID in
  the URL didn't exist (stale link, copy-paste typo, or instance deleted),
  making the URL look valid. The route now probes `getWaInstance` in
  `beforeLoad` and redirects to /whatsapp if it 404s, so the user lands on
  the instance list instead of an unhelpful pairing screen.
- a2f8a1f: POS cashier: clicking "Tukar" on an eligible stamp card now auto-adds the reward item(s) into the cart at 100% off, instead of requiring the cashier to first ring them up manually. Works for both single rewards (qty 1) and bundle rewards (qty per bundle entry). Auto-added rows are tracked separately so that cancelling the redemption removes them from the cart entirely — pre-existing lines the cashier had already rung are left in place with their discount cleared, matching the previous behaviour. `listPOSProducts` gained an optional `itemIds` filter so the cashier can fetch reward items outside the current category/search view.
- a2f8a1f: Auto-deduct sub-recipe ingredients on sale (recursive BOM walk).

  Recipes can contain sub-recipes — a BOM row referencing another HPP product instead of an atomic material. Previously both the display and the stock deduction stopped at the top level: the inventory item detail page showed a "fitur menyusul" placeholder, and a sale only deducted top-level materials.

  Now:

  - `deductBomIngredients` recurses into sub-recipe rows, scaling the consumed quantity by the sub-recipe's production batch size (`quantity / productionQty`). Cycle-guarded via an ancestor set and depth-capped at 8.
  - A sub-recipe that can't be scaled — no `productionQty`, a recipe unit that doesn't match its `productionUnit`, or a recursion cycle — is skipped and surfaced as a one-time owner notification; the sale is never blocked over recipe config.
  - The inventory item detail page now renders the full nested sub-recipe tree with each sub-recipe's ingredients (linked/unlinked status included), replacing the placeholder. Unscalable sub-recipes show an inline "set production qty" note.

- a2f8a1f: Document the JUR-185 subdomain nginx pitfall: if
  `sites-enabled/public-tenant` is a regular file rather than a symlink
  to `sites-available/`, edits to `sites-available/` silently fail to
  take effect on reload. Symptom on subdomain: SSR works but the
  client-side server-fn `POST /_serverFn/<hash>` returns 500
  `{"error":"Only HTML requests are supported here"}` because a stale
  `rewrite ^(.+)$ /q/$sub$1 break;` is still rewriting the path before
  it reaches Node. Adds an explicit symlink-check step to
  SUBDOMAIN-DEPLOY.md and a troubleshooting row with the exact fix.
- a2f8a1f: JUR-176 Phase 2: tenant public-site template engine + editor.

  - New `tenant_sites` table (1-row-per-tenant, with co-resident draft +
    published settings blobs and template id) and `site_publish_history`
    (append-only, trimmed to last 5 per tenant) — migration 0066.
  - Registry-driven template engine in
    `apps/web/src/lib/site-templates/` with shared section schemas
    (header/about/modules/contact/seo), shared module components
    (Header, About, Queue, Services, Hours, Branches, Contact, Footer),
    and 5 starter templates: Mini, Warung Modern, Toko Retail, Salon /
    Jasa, Kafe / Resto. Each renders a visibly distinct hero so the
    picker preview communicates "this is a different look" at a glance.
  - `/site/edit` editor route with template picker, sectioned form
    generated from the active template's field schema, inline live
    preview, Simpan Draft + Publikasikan, and a publish history list
    with Pulihkan (rolls a snapshot back into the draft — never
    auto-republishes).
  - Public renderer (`PublicSitePage`) replaces `PublicQueuePage` on
    index + `/q/$slug` routes; falls back to the JUR-185 baseline queue
    view for tenants who haven't published yet, so no regression for
    the cuci motor customer already live at `mantra.vintra.my.id`.
  - Sidebar: "Situs" promoted to its own top-level entry (Globe icon)
    instead of being nested under Booking.

  Permission gate stays on `booking.write` for v1 — the slug claim from
  JUR-185 already lives there. A dedicated `site.write` permission can
  be split out later without touching the editor or template code.

  Image upload widget renders a "Coming Soon" placeholder until the S3
  wrapping for `tenant-site` assets ships in a follow-up. Logo / hero /
  OG image fields save the asset key but the renderer skips the `<img>`
  tag when no URL resolves.

- a2f8a1f: Route the transaction-detail Cetak button through the thermal printer.

  The thermal-printer Cetak path was only wired into the post-sale success modal — the transaction-history detail page (`/pos/sales/:id`) still opened a PDF blob. The full thermal pipeline (fetch payload → dither logo → render ESC/POS → write) is now extracted into `useThermalPrinter().printReceipt`, shared by both screens. When a printer is paired the detail page's Cetak prints straight to it; otherwise it falls back to the PDF preview as before.

- a2f8a1f: Bring `bun tsc` to zero errors and stop emitting `.js`/`.d.ts` artifacts.

  **Root causes & fixes**

  - Aligned `drizzle-orm` to `^0.45.1` in `apps/web` (was pinned to `^0.38.0`, which forced a second drizzle copy under `apps/web/node_modules`). The duplicate install made TS treat every drizzle expression as two unrelated types and accounted for ~1000 of the 1104 errors.
  - Set `noEmit: true` in `tooling/typescript/tsconfig.base.json` and dropped `declaration` / `declarationMap` / `sourceMap`. Vite owns the build; tsc is type-check-only now, so running `tsc` no longer leaks `.js` / `.js.map` / `.d.ts` files alongside source.
  - Typed the two `jsonb` columns (`notifications.data`, `platformAdminAuditLogs.metadata`) so TanStack Start's server-fn serialization narrowing accepts them.
  - Fixed the `noUncheckedIndexedAccess`-incompatible `const [{ count }] = await db.select(...)` pattern across 7 server-fn files.
  - Misc: missing imports (`ilike`, `ResolvedSchedule`), removed obsolete `tanstackStart({ target: 'node-server' })` config, `proofKey` → `proofPhotoKey` field name fix, removed `.default(0)` on inventory item `costPrice` (incompatible with RHF's Resolver typing — defaults now come via `defaultValues`), nullish guards on i18n `t()` and form field-state messages, BufferSource cast for WebPush.

  **New script**

  - `bun run typecheck` (root) → `tsc --noEmit` in `apps/web`. Use it to verify type safety without spawning compiler output.

- a2f8a1f: Unify additional-outlet flow + keep Komplit banner persistent for renewal.

  Three pieces, one design correction:

  - **Single "Tambah Outlet" button.** Replaces the per-module "Outlet Tambahan" buttons that were added in the prior commit. The old per-module model double-charged Komplit tenants — clicking POS card paid Rp 45k × months, then admin would click Inventory card and pay Rp 20k × months again, even though the Komplit Rp 45k rate already includes Inventory. The new button opens a sheet that asks **which package** the new outlet uses:

    - **Komplit (bundle)** — single charged POS row at the Komplit additional rate + paired Rp 0 Inventory row keeping both modules' billed counts in sync.
    - **POS only (kiosk)** — POS Toko à la carte additional rate.
    - **Inventory only (gudang)** — Inventory Toko à la carte additional rate.

    Options shown depend on what the tenant has active. Komplit users see all 3 options (full bundle, POS-only kiosk, gudang). Toko-only POS users see just the POS option. Each option's row shows its rate per month and a green "Hemat X%" pill mirroring the marketing language on the pricing page, computed from `(firstOutletPrice - additionalRate) / firstOutletPrice`.

  - **Komplit banner persists post-purchase.** Was hiding via `if (isAlreadyKomplit) return null` so admin couldn't easily perpanjang from one place. Now stays visible with mode-aware copy: "Aktifkan Komplit" for non-Komplit, "Perpanjang Komplit" for active Komplit tenants. The expiry banner inside shows current Komplit expiry so the admin sees runway at a glance.

  - **Server-side route logic.** `recordAdditionalOutletPayment` now accepts `packageKey` instead of `moduleKey`. For Komplit it writes two `financial_transactions` rows in one transaction (primary POS row charged the bundled rate, mirror Inventory row at Rp 0 with bumped billed count). For à la carte options it writes only the relevant module's row. `getAdditionalOutletContext` returns the available package options for the tenant so the sheet can render dynamically.

  Math check: Mantra Maker on Komplit Annual adding a full-bundle outlet now correctly charges **Rp 45 000 × 12 = Rp 540 000** (18% cheaper than the Rp 660k first outlet — matching the pricing-page promise). Previous broken per-module flow was charging **Rp 65k × 12 = Rp 780k** (worse than the first outlet).

- a2f8a1f: Fix: voiding a POS sale now reverses stamp-card movements the same way it already reverses loyalty points. Previously, redeemed stamps stayed gone (and earned stamps stayed on the card) after a void — so a customer who cancelled a transaction and re-entered it would find the stamp indicator missing because their card was still drained from the original sale. `voidSale` now writes compensating `'adjust'` rows to `customer_stamp_movements` and bumps `customer_stamp_cards.current_stamps` by the inverse of the original earn/redeem. `lifetime_stamps` / `lifetime_rewards` are intentionally left alone, mirroring the existing loyalty-points behaviour.
- a2f8a1f: Fix AI auto-reply silently skipping inbound image/video/document
  messages that have a caption. The wa:incoming worker only
  enqueued ai:reply when `type == "text"`, so a customer asking
  "saya mau beli ini" with a product photo got persisted but no
  reply ever fired.

  Now any inbound with non-empty body (text OR media caption) gets
  routed to the AI. Pure media without a caption is still skipped
  (vision is out of scope for v1) — sidebar shows the message,
  operator handles manually.

- a2f8a1f: Add panic-recovery wrappers (`internal/safego`) for whatsmeow event
  handlers and background goroutines.

  Fiber's `recover` middleware already protects HTTP handlers and asynq
  recovers task handlers — the gap was whatsmeow callbacks (event bus)
  and our own background goroutines (`registry.Revive`, `asynq.Run`,
  `http.Listen`). A panic in any of those would kill the whole api
  process and force every connected tenant to rescan their QR code.

  The new `safego.Recover`, `safego.Go`, and `safego.RecoverFn` wrappers
  log panics with structured slog (label + panic value + stack) and
  continue. Wired into:

  - `whatsmeow.AddEventHandler` — primary risk: malformed protocol
    events causing nil-pointer derefs in our event parser
  - `registry.Revive` background goroutine — startup-only but a panic
    there would crash the process before any tenant could connect
  - `asynq.Run` and `http.Listen` goroutines — defensive

  Closes JUR-40.

- a2f8a1f: Add `docs/wa-chaos-smoke.md` — the production chaos smoke runbook
  gating the M4 hardening milestone (JUR-48).

  10 scenarios covering:

  1. Cold deploy
  2. End-to-end AI roundtrip
  3. Airplane-mode reconnect
  4. WhatsApp logout (no infinite reconnect)
  5. SIGTERM mid-send graceful shutdown
  6. OOM / memory bounds
  7. Redis restart
  8. Rate-limit token bucket enforcement (JUR-43 verification)
  9. Synthetic panic recovery (JUR-40 verification — needs revert
     before merge)
  10. Handoff workflow end-to-end (JUR-74 verification)

  Each scenario has a pass/fail criterion + suggested commands. Sign-off
  checklist at the end. The actual run requires a deployed staging VPS,
  which is human-ops territory — this commit ships the runbook so the
  engineer running it has a single source of truth.

- a2f8a1f: DELETE /v1/wa/instances/:id now eagerly cleans up everything the
  instance touched, not just the Postgres rows:

  - DB cascade (unchanged): wa_messages, wa_contacts deleted via the
    existing FK onDelete: cascade.
  - New: `registry.Purge` closes the in-memory whatsmeow socket AND
    removes the per-instance SQLite session file (`data/{id}.db` +
    -wal/-shm sidecars). Previously the socket leaked until restart
    and the SQLite file accumulated forever.
  - New: `storage.Client.DeletePrefix` lists + batch-deletes every S3
    object under `{tenantId}/wa/{instanceId}/`. Saves us up to 3 days
    of waiting for the kind=wa-media lifecycle rule to catch up.

  All three cleanup steps are best-effort with structured logging —
  DB delete is the source of truth; if registry/S3 cleanup fails, the
  api restart + S3 lifecycle eventually self-heal.

- a2f8a1f: Add `docs/wa-dev.md` — runbook for the ngrok-based local dev flow against the WA api (JUR-59).

  Covers prerequisites (Bun, Docker, ngrok), the local stack (`docker compose up -d redis` + `bun --watch src/main.ts`), the tunnel setup, the two ways to wire web at the tunnel (local web dev vs. prod web temporarily), explicit safety rules for the prod-pointing path (don't leave it on, don't share the URL, local Redis sessions don't transfer), an end-to-end auth-flow recap, and a troubleshooting table for the common boot/connect failures we've already seen in this codebase.

  Also annotates `apps/web/.env.example` with the three valid `API_URL` values (local / ngrok / prod) and a pointer to the new doc.

- a2f8a1f: Two bug fixes surfaced testing the v1 media flow:

  - AI's empty completion no longer produces a blank WhatsApp bubble.
    DeepSeek occasionally returns "" when the conversation context is
    ambiguous (e.g., the customer declines a handoff suggestion right
    after the contact comes out of handoff). Previously we'd persist +
    send the empty body, which produced a content-less green bubble at
    the customer's end. Now we log a warn and skip the persist; the
    operator can follow up manually if it matters.
  - Inbound reactions / protocol messages (edits / revokes / disappearing-
    mode toggles) no longer appear as "[Pesan tidak didukung]" bubbles
    in the chat. New `isSkippableMessage` filter drops them in the
    provider before dedupe + enqueue. Reactions aren't modelled yet —
    v2 work to attach them to the parent message.

- a2f8a1f: Backend foundation for the WhatsApp AI human-handoff workflow (JUR-74 v1).

  When the AI decides it can't help and tells the customer "alihkan ke
  admin", it now actually does:

  - **Pre-reply check** — `wa_contacts.needs_human=true` skips AI auto-reply
    for that contact. Auto-resumes after `wa_instances.handoff_auto_resume_hours`
    if the customer sends a new message past the timeout (default 24h).
  - **Post-reply detection** — heuristic substring match on the AI's
    reply for handoff phrases (`alihkan ke admin`, `hubungkan ke admin`,
    etc.). When matched, marks the contact and dispatches admin notification.
  - **Admin WhatsApp notification** — enqueues a `wa:send` task from the
    same instance to the configured `admin_phone`. Self-send guard
    prevents accidentally messaging the instance's own number.
  - **Manual resume endpoint** — `PATCH /v1/wa/instances/:id/contacts/:jid/handoff`
    with `{enabled}` to toggle. Also supports manual pause for admins to
    pre-empt AI on sensitive chats.
  - **Group chats** (`@g.us`) skip handoff entirely.

  Two columns added to `wa_instances`: `admin_phone`, `handoff_auto_resume_hours`.
  Four columns added to `wa_contacts`: `needs_human`, `handoff_at`,
  `handoff_reason`, `handoff_summary`. Partial index on
  `(instance_id, needs_human) WHERE needs_human` for fast badge lookups.

  **Deferred to JUR-74-followup tickets** (intentionally out of scope here):

  - Structured JSON output from the LLM (Option B). v1 uses heuristic
    detection because the system prompt already enforces consistent
    handoff phrasing. Switch when production data shows misses.
  - In-app notification + web push channels. v1 ships only the WhatsApp
    channel, which is the highest-signal one for merchants.
  - Admin UI: Pengaturan AI form section + chat banner + sidebar badge.
    Backend supports it; the React surfaces land in the followup ticket.

- a2f8a1f: Add `/healthz` and `/readyz` ops endpoints to the api.

  - `GET /healthz` — cheap liveness check. Returns `{ok, uptime, version,
go}` without touching any downstream. For process supervisors
    (systemd, PM2) deciding whether to restart the process.
  - `GET /readyz` — readiness check. Pings Postgres + Redis (each with a
    1-second per-dep timeout), reports per-dep status, and includes
    `activeInstances` count from the whatsmeow registry. Returns 503 with
    the same JSON when any dep fails so load balancers can drop the
    instance from rotation.

  Both are unauthenticated and live at the root (no `/v1` prefix) so
  monitoring URLs stay short and version-stable.

  `appVersion` is overridable at build time via `-ldflags`. Closes JUR-41.

- a2f8a1f: WhatsApp Komplit tier: bump replies cap 10k → 20k and clean up the
  feature copy so the upgrade story actually matches what each tier
  delivers.

  - DB: `wa_subscription_plans.max_monthly_replies` for `komplit`
    goes from 10000 to 20000. Now 4× Basic capacity for 3× the price
    (Komplit cost-per-reply Rp 7.45 vs. Basic Rp 9.80) — clean upsell.
  - In-app billing page (`/whatsapp/billing`) and public pricing page
    (`/pricing`):
    - Removed "Ketersediaan menu (resep / HPP)" from Komplit's bullet
      list — it was misleading because Basic also has that RAG tool
      (`min_tier='basic'` on `recipe_availability`).
    - Added "ketersediaan menu (resep / HPP)" to Basic's RAG bullet so
      its actual capability is properly disclosed.
    - Komplit replies bullet now reads "20.000 balasan AI/bulan
      (4× kapasitas Basic)" on the landing page.

  Admin panel `/admin/wa-plans` reads from the DB directly, so the new
  cap shows there automatically — no code change needed.

- a2f8a1f: WhatsApp staff OTP login — Go API detector + service (PR 2 of the series). The `wa:incoming` worker now intercepts inbound messages that match the OTP-request pattern (`/\b(otp|login|masuk|kode\s*login)\b/i`, max 60 chars) when (a) the per-instance `otp_login_enabled` flag is on, (b) the tenant subscription is basic+ and active, and (c) the sender's phone resolves to an opt-in `tenant_members` row. On match the worker generates a 6-digit code (crypto/rand), argon2id-hashes it, persists to `wa_login_otps` with a 5-min TTL, and enqueues a `wa:send` task carrying the cleartext reply — piggybacking on the existing send rate limiter so we don't risk a ban. Per-phone request rate limit caps OTP generation at 3/hour via a Redis fixed-window counter. AI auto-reply is skipped for handled OTP requests so customers don't see a stray AI response next to the code. No HTTP endpoints or UI yet — those ship in subsequent PRs.
- a2f8a1f: WhatsApp staff OTP login — owner UI + control surface (PR 6 of the series).

  **WA instance settings (`/whatsapp/$id`).** New "Login Karyawan via WhatsApp" card with the per-instance `otp_login_enabled` toggle. The inbound detector checks this BEFORE running the OTP regex, so disabled instances pay zero runtime cost. Save shares the existing "Simpan Pengaturan" button — one PATCH for AI + handoff + login.

  **Members page (`/settings/members`).**

  - Emerald info card at the top shows the tenant's WA login URL (`/auth/wa-login/{slug}`) with a one-click "Salin link" copy button — owners share this with staff once.
  - New "Login WA" column. Per non-owner member, shows: "Butuh HP" when phone is unset; "Aktifkan" link when phone is set but flag is off; green "Aktif" badge that toggles back off on click when on.

  **Server functions.**

  - `setTenantMemberWaLogin({ memberId, enabled })` — toggle the per-member flag. Refuses to enable when the member has no phone (server-side enforcement of the same rule the UI shows).
  - `invitePhoneOnlyTenantMember({ firstName, phone, roleId, branches, ... })` — creates a Supabase auth user with a synthetic `wa-{slug}-{phone}@login.vintra.local` email, inserts the tenant_members row with `wa_login_enabled=true` + `wa_login_email` populated. UI for this path ships in PR 7.
  - `getTenantSlugForWaLogin()` — read-only helper for the copy-URL card.

  **API.** The wa_instances PATCH endpoint now accepts `otpLoginEnabled` and the response includes it. `listTenantMembers` now surfaces `waLoginEnabled` + `waLoginEmail` on every row.

- a2f8a1f: WhatsApp staff OTP login — normalize `tenant_members.phone` at the storage boundary so the inbound detector can use a direct SQL equality lookup instead of the O(N) Go-side scan.

  **Schema.** Migration `0074` runs a plpgsql backfill that rewrites every existing phone to the canonical `62XXXXXXXXXX` E.164 form (logic mirrors `walogin.NormalizeIDPhone` and `normalizeIDPhone` exactly). Rows that are out-of-range or unparseable are left as-is — same failure mode they had under the old scan. Also adds partial index `tenant_members_wa_login_phone_idx (tenant_id, phone) WHERE wa_login_enabled = true` so the new lookup is O(log N) over the opt-in subset.

  **App side.** New `coerceStorablePhone()` helper in `@vintra/shared` (normalize-or-keep-trimmed-original; never wipes valid input). Wrapped at every `tenant_members.phone` write path:

  - `inviteTenantMember`, `updateTenantMemberProfile` (tenant-members.ts)
  - `createStaffProfile` (×2 paths) (attendance-staff.ts)
  - `completeOnboarding` (auth.ts)

  `invitePhoneOnlyTenantMember` already normalized via `normalizeIDPhone` strict (rejects malformed) so no change there — that path is WA-login-specific and stricter on purpose.

  **Detector.** Replaces `ListOptInTenantMembersByTenant` + Go-side scan with new `GetOptInTenantMemberByPhone` query — direct `(tenant_id, phone)` equality lookup backed by the partial index. ~1ms p99 regardless of staff count, vs. the prior linear scan.

- a2f8a1f: WhatsApp staff OTP login — polish (PR 7, final of the series).

  **Phone-only invite UI.** `/settings/members` Undang sheet now offers a "Tipe Undangan" radio at the top with two modes:

  - _Email + Password_ — the existing path; email required, phone optional.
  - _WhatsApp (tanpa email)_ — phone required (the email field is hidden), no photo upload. Submit routes through `invitePhoneOnlyTenantMember` from PR 6. The server generates a synthetic Supabase email and flips `wa_login_enabled` on so the new member can log in immediately via the tenant's WA login URL.

  **Audit log.** API `walogin.Service.VerifyAndConsumeOtp` emits a structured `slog.Info` line on every successful verify carrying tenant_id, member_id, user_id, normalized phone, and a synthetic_email flag. Lands in the same log stream as the rest of the API so existing shippers pick it up. OTP plaintext is never logged anywhere.

  **Boot-time OTP cleanup.** New `DeleteStaleWaLoginOtps` query deletes consumed-or-expired rows older than 30 days. A fire-and-forget goroutine in `cmd/api/main.go` runs it on every process start — good enough for a table that grows ~10s of rows per tenant per day. Wrapped in `safego` so a panic doesn't crash boot.

  (Prometheus counters mentioned in the original plan are deferred — the project has no metrics infrastructure yet; adding it is its own multi-PR effort.)

- a2f8a1f: WhatsApp staff OTP login — public HTTP endpoints (PR 3 of the series). Adds two unauthenticated routes on the Go API:

  - `POST /v1/auth/wa-login/request` — resolves a tenant slug to its connected, paid-tier, OTP-enabled WhatsApp instance and returns a wa.me deep link. Does NOT generate an OTP; that only happens when an inbound WhatsApp message arrives at the tenant's instance (preserves the ban-safe "user-initiated conversation" property).
  - `POST /v1/auth/wa-login/verify` — validates a user-submitted 6-digit code against the latest unconsumed unexpired OTP for the (tenant, phone) pair. On match, consumes the row atomically (FOR UPDATE) and returns the staff identity (`userId`, optional synthetic `authEmail`, `tenantId`) for the web layer to mint a Supabase session.

  Per-phone verify rate limit (5/hour, Redis fixed-window) caps online brute-force, working alongside the per-OTP 3-attempt cap that already kills the row after the third wrong guess. Both endpoints return identical generic errors for "tenant unknown" / "feature unavailable" / "phone not registered" / "wrong code" so phone+tenant enumeration leaks nothing.

- a2f8a1f: Schema groundwork for WhatsApp OTP staff login (PR 1 of the series). Adds `wa_login_otps` (short-lived 6-digit codes, argon2id-hashed, 5-minute TTL), `wa_instances.otp_login_enabled` (per-instance owner toggle), `tenant_members.wa_login_enabled` (per-member opt-in), and `tenant_members.wa_login_email` (synthetic Supabase email for phone-only staff). All additive — existing rows keep current behavior until owners flip the new flags. No runtime code wired up yet; the inbound detector, HTTP endpoints, and login UI ship in subsequent PRs.
- a2f8a1f: WhatsApp staff login — slug-less entry point on the main login page. Replaces the passive "ask your owner for the link" hint with an active **"Masuk dengan WhatsApp"** button that goes to a new `/auth/wa-login` landing where staff types their **tenant code** (slug) + phone. On submit the page redirects to the existing slug-specific route with the phone already filled in via `?phone=` search param — the slug page auto-fires the OTP request so staff types phone once, not twice.

  Restructured the WA-login routes into a subdirectory (`routes/auth/wa-login/index.tsx` + `routes/auth/wa-login/$tenantSlug.tsx`) to avoid TanStack Router's flat-file layout/leaf ambiguity. URLs are unchanged: `/auth/wa-login` and `/auth/wa-login/{slug}` still work the same.

  Deliberately does **not** look up tenant by phone — that would let anyone probe whether a phone is registered staff anywhere on the platform. Staff has to know their tenant code; the owner shares it from `/settings/members`, and the slug-specific bookmarked URL is still the canonical fast path.

- a2f8a1f: WhatsApp staff OTP login — login UI (PR 5 of the series). Adds a new route `/auth/wa-login/$tenantSlug` with a two-step state machine:

  1. Phone input — user enters their WA number. Accepts `08xx`, `+62 8xx`, `628xx`. Shared `normalizeIDPhone()` from `@vintra/shared` canonicalizes before the API call.
  2. Verify — page shows a green "Buka WhatsApp" CTA opening the wa.me deep link with the prefilled "Minta OTP Login Vintra" text. User sends, gets the code on WhatsApp, types the 6 digits back. 5-minute countdown displayed; expired state disables the verify button.

  On verify success the server fn returns Supabase session tokens; the page sets sb-access-token / sb-refresh-token cookies (mirrors the email/password path) AND calls `supabase.auth.setSession()` on the browser client so signOut/refresh continue to work. Then navigates to `/dashboard`.

  The existing `/auth/login` page gets a passive emerald hint card directing staff to ask the owner for the tenant-specific login URL — owners share `vintra.my.id/auth/wa-login/{slug}` with staff once and they bookmark it. The owner-facing UI for managing this ships in PR 6.

  Error messages from the API are mapped to short Indonesian strings ("Kode salah atau sudah kadaluarsa", "Login WhatsApp belum aktif untuk toko ini", etc.) — never reveal which specific failure mode hit.

- a2f8a1f: WhatsApp staff OTP login — web server functions + Supabase magic-link minting (PR 4 of the series). Adds `apps/web/src/server/functions/wa-login.ts` with:

  - `requestWaLoginOtp({ tenantSlug, phone })` — proxies the public `/v1/auth/wa-login/request` endpoint. No Supabase cookies forwarded.
  - `verifyWaLoginOtp({ tenantSlug, phone, otp })` — calls the API verify endpoint, then mints a Supabase session via `supabase.auth.admin.generateLink({ type: 'magiclink' })` + `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })`. Returns `{ accessToken, refreshToken }` so the login UI can set sb-access-token / sb-refresh-token cookies via the same browser-side path as email/password login. Phone-only staff use the synthetic `wa_login_email` returned by the API; staff with real emails get resolved through `admin.getUserById`.

  Also adds `normalizeIDPhone()` + Zod schemas to `@vintra/shared` — byte-equivalent with the Go `walogin.NormalizeIDPhone` in PR 2, so both ends of the flow produce the same canonical "62XXXXXXXXXX" string for DB lookup. UI ships in PR 5.

- a2f8a1f: WhatsApp: surface the 24-hour media retention policy so tenants don't
  hit "media tidak tersedia" placeholders by surprise.

  - Dashboard: prominent blue info card under the stat cards explaining
    that foto/video/dokumen are auto-deleted after 24h while text
    messages stay permanent.
  - Chat composer: paperclip tooltip rephrased to call out the 24-hour
    window, and the staged-image preview's metadata line now says
    "X KB · disimpan 24 jam" so it shows up at the moment of upload.

  Mirrors the actual JUR-79 S3 lifecycle policy (kind=wa-media, 1-day
  expiry).

- a2f8a1f: WhatsApp: alternative pairing flow via phone-linking code (no QR scan).

  Solves the chicken-and-egg for merchants who open the dashboard on
  the same phone they want to link — they can't realistically scan a QR
  code on the same screen. Now they enter their number, get a 6-char
  code, paste it into WhatsApp's "Tautkan dengan nomor telepon" flow.

  - Go api: `POST /v1/wa/instances/:id/pair-code` calls
    `whatsmeow.PairPhone` after waiting for the socket to reach the
    pairing-ready state. Same auth + tenant middleware as Connect;
    same purge-on-logged-out hygiene.
  - Web: `pairWaInstanceWithCode` server fn gated by `whatsapp.manage`
    (owner/admin only, same as Connect). New "Gunakan Kode" button
    next to "Pindai QR" on the instance detail header + on the
    `NotPairedGate` empty state.
  - Code dialog shows the linking code in a large mono font with
    step-by-step Indonesian instructions matching WhatsApp's mobile UI.

- a2f8a1f: Three pre-deploy polish items for WhatsApp v1:

  - Linked-device name now shows "Vintra" instead of "whatsmeow" on
    the paired phone's Settings → Linked Devices screen. Existing paired
    instances keep the old name — re-pair (scan QR again) to refresh.
    See https://github.com/tulir/whatsmeow/issues/89.
  - "Tambah WhatsApp" button is disabled when the tenant has reached
    their subscription's max instances. Tooltip explains the cap and
    suggests upgrade. (Basic = 1 instance, Komplit = 3.)
  - Chat sidebar + conversation header now show the master-data customer
    name (when the contact's phone matches a `customers` row for this
    tenant). The customer's WhatsApp profile name is shown as a secondary
    "WA: {push_name}" line when it differs from the saved name, so the
    operator can confirm it's the right person. No new schema —
    customers.phone is already canonical "628..." from migration 0022.

- a2f8a1f: Configurable RAG (retrieval-augmented generation) for WhatsApp AI replies.

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

- a2f8a1f: Two small WA polish items from feedback:

  - New WhatsApp instances now land with every basic-tier RAG tool
    pre-enabled (price, stock, recipe availability, store address,
    operating hours, payment methods). Previously the toggles all
    defaulted to off, leaving brand-new tenants with a useful AI tier
    they didn't know they had. The seed runs as part of
    `POST /v1/wa/instances` and uses `ON CONFLICT DO NOTHING` so
    re-creating an instance never clobbers explicit user choices.
    Existing instances are unaffected — they already have rows.
  - Chat detail page now scrolls to the most recent message when the
    conversation panel mounts (including the case where the user flips
    to Pengaturan AI and back to Chat — same `selectedJid`, same
    `messages` array, so the previous effect didn't re-fire). Switched
    to `useLayoutEffect` so the scroll lands before paint instead of a
    flash at the top of the thread.

- a2f8a1f: Add per-instance + per-JID rate buckets to the WhatsApp send worker.

  WhatsApp permanently bans accounts that send too fast — and the ban
  is irrecoverable on that number. Without throttling, a runaway script
  or accidental loop sending to one customer can kill a paying tenant's
  phone line forever.

  The new `internal/ratelimit` package implements an atomic two-level
  token bucket via Redis Lua:

  - **Per-instance** (default 10/sec): account-wide cap so one tenant's
    bursts don't take their own number down.
  - **Per-JID** (default 1/sec): per-recipient cap so the same customer
    can't be flooded.

  Both buckets must allow the send. The Lua script consumes from both
  atomically — never partially — so concurrent workers can't game it.

  Wired into the `wa:send` asynq worker. When the bucket can't allow
  the send within `WA_RATE_MAX_WAIT_MS` (default 5s), the task returns
  `ErrRateLimited` and asynq retries with its own exponential backoff —
  which spaces out the next attempt naturally.

  Configurable via env: `WA_RATE_PER_INSTANCE_PER_SEC`, `WA_RATE_PER_JID_PER_SEC`,
  `WA_RATE_BUCKET_CAPACITY`, `WA_RATE_MAX_WAIT_MS`. Setting either rate
  to 0 disables that level.

  Tests cover throttling, max-wait timeout, JID isolation, and disabled
  buckets. Closes JUR-43.

- a2f8a1f: Introduce WhatsApp AI subscription tiers with monthly-reply limits.

  - New `wa_subscription_plans` table seeds three platform-managed tiers:
    - `basic` Rp 99.000/mo — 1 instance, 1.000 AI replies, stock-scoped RAG (future).
    - `komplit` Rp 299.000/mo — 3 instances, 5.000 AI replies, full RAG (future).
    - `enterprise` Rp 800.000/mo — 10 instances, 50.000 AI replies, full RAG (future).
  - New `wa_settings` table holds each tenant's current tier + subscription window.
  - `ai:reply` worker now enforces the monthly reply cap before invoking the AI provider; over-limit messages skip silently with a structured warn log.
  - Admin "Paket WhatsApp" page lets platform admins edit each plan's price, instance/reply limits, RAG scope, and active flag.
  - WhatsApp instance list shows a subscription usage card (progress bar against monthly cap) with an amber warning at ≥90% utilization.
  - New `GET /v1/wa/subscription` returns the tenant's current tier, limits, used replies, and subscription expiry for the UI.
  - `rag_scope` column is wired into the schema and admin UI but **not yet read by the worker** — feature-gated RAG retrieval is tracked separately and will follow in a later milestone.

- a2f8a1f: Add WhatsApp + AI tables to `@vintra/db` (JUR-23, M1 of WhatsApp AI Backend).

  New schema files `packages/db/src/schema/whatsapp.ts` (`wa_instances`, `wa_messages`, `wa_contacts`) and `packages/db/src/schema/ai.ts` (`ai_usage_logs`). All four tables carry a `tenant_id` FK to `tenants(id) ON DELETE CASCADE`; `wa_messages` and `wa_contacts` also FK on `wa_instances(id) ON DELETE CASCADE`. Money is `numeric(12,6)` (never float). Indexes optimized for the conversation-tail hot read (`wa_messages` (instance_id, remote_jid, created_at)), dedupe by Baileys `external_id`, and the monthly-cost rollup (`ai_usage_logs` (tenant_id, created_at)).

  Migration `0036_whatsapp_ai.sql` was hand-written rather than via `drizzle-kit generate` because the existing `meta/0004_snapshot.json` and `meta/0005_snapshot.json` are byte-identical with the same `id`/`prevId`, which makes drizzle-kit fail with a "snapshot collision" error before producing any output. The runtime migrator (`drizzle-orm/postgres-js/migrator`) only reads `_journal.json` + SQL files, so this works fine — we just lose snapshot regeneration until the historical dupe is cleaned up in a separate change.
