---
"@vintra/web": patch
---

Polish landing pricing cards.

- Notification bell moved to the right of the language and theme toggles in the app header (was previously at the left of the action group).
- "Hemat X%" savings now renders as a superscript-style price tag lifted above the price baseline (math-exponent feel), with a TrendingDown icon, instead of a full-width banner under the price. Same look in both Absensi and Stok Barang cards.
- Stok Barang annual price line restructured to match the Absensi layout: `Rp X` + superscript badge on one line, `per bulan, paket tahunan` on the line below. The previous inline `/bulan` was forcing the badge to wrap at narrow column widths.
- Aktifkan / CTA buttons get more breathing room: Absensi cards wrap the button in `mt-auto pt-8` so even on the densest column there's a 32px gap above; Stok Barang button bumped from `mt-6` → `mt-8` for visual parity.
