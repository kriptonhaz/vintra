---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

JUR-176 follow-ups: hide booking duration on POS-only items + tax
disclaimer.

- Services data now carries `isBookable` per item. The Services
  section's "X menit" badge only renders when both the section's
  `showDuration` toggle is on AND the item is bookable AND duration
  > 0. POS-only items (instant noodles for waiting customers) no
  longer get a meaningless minute label.
- `getEditorPreviewData` + `fetchPublicQueueDataForSlug` now fetch
  `pos_settings.taxes` and aggregate active rows into
  `{ totalPercent, labels }`. When at least one active tax exists,
  the Services section appends a footnote: *"Harga belum termasuk
  PPN + PB1 (21%)."* (labels join with "+" so stacked taxes read
  naturally). Pure copy — doesn't recompute prices.
- Per-item booking duration was already supported on the inventory
  schema + edit form (`/inventory/items` → click edit on a bookable
  item → "Durasi booking (menit)"). No code change needed; this
  surfaces it as discoverable via the renderer's new gating.
