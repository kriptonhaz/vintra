---
"@vintra/web": minor
---

Finish the Purchase Order UI — close the last gap in Inventory Phase 1.

The PO server functions (create / send / receive / cancel) shipped with Phase 1 but the UI was deferred. The page that listed POs had no "Buat PO" button, no detail view, no way to mark received. This change wires all of it.

**List page** (`po.index.tsx`, renamed from `po.tsx` so a `$poId` sibling can render properly)
- "Buat PO" button in the header.
- Status filter chips (All / Draft / Terkirim / Sebagian / Diterima / Dibatalkan) with live per-bucket counts.
- Each row links to `/inventory/po/$poId`.

**Detail page** (`po.$poId.tsx`)
- PO header: number, supplier, branch, created date, status pill.
- Status-aware action bar: `draft` → Kirim + Batalkan; `sent` / `partial` → Terima + Batalkan; terminal states show no actions.
- Meta strip (expected / received / total).
- Lines table with ordered vs received per line (color-coded green when full, amber when pending).
- Notes block.
- Confirm dialogs for Kirim and Batalkan.

**Create sheet** (`components/inventory/create-po-sheet.tsx`)
- Supplier picker, branch picker, expected delivery date, top-level notes.
- Dynamic line editor: searchable item Combobox, qty, unit cost, live subtotal, optional per-line notes, add/remove.
- Auto-fills unit cost from the picked item's current `costPrice` (only when empty — never overwrites typed values).
- Live total. Validation refuses submit if no supplier / branch / line with qty > 0.
- On success: navigates to the new PO's detail page.

**Receive sheet** (`components/inventory/receive-po-sheet.tsx`)
- **Mental model flipped: input = "this batch" (Diterima batch ini), not cumulative.** Matches how a warung owner thinks ("the truck brought 5 kg today") instead of the previous confusing "5 cumulative" model that silently treated batches as no-ops.
- Per line shows `Dipesan / Sudah diterima / Sisa` so the order math is unambiguous.
- Pre-fills the batch input with `Sisa` (most common case: "the rest just arrived"); user dials down for true partials.
- Hard client validation: refuses any batch > remaining (red inline error + form-level error). Server still clamps as defence in depth.
- Live "Setelah ini: X / Y" preview turns brand color when the batch will fully close a line.
- Already-fully-received lines render with a green confirmation panel — no input shown, no accidental re-receive.
- "Penuh" button per line snaps to remaining (not ordered, so it never overshoots).
- "Tandai semua penuh" header button does the same for every still-open line at once.
- No-op guard: refuses to submit if every line's batch is 0.

i18n: ~50 new keys (status labels, create flow, action confirmations, receive flow, error messages) added to both `id.json` and `en.json`.
