---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-141 / JUR-145 PR 4 — Peti Kas polish (final piece of the feature):

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
