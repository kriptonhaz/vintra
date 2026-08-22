---
"@vintra/web": minor
---

Show each inventory item's margin in Inventaris.

Resale goods — snacks, bottled drinks, anything bought to be resold as-is —
never pass through HPP, so Laporan HPP could not see them and their margin was
invisible until the item had actually been sold and showed up in a POS report.
Both numbers were already stored; nothing brought them together.

The item list now shows a margin pill beside the price, and the item detail
page shows one per pricing tier (replacing the bare "Rugi" badge, which said
there was a problem without saying how big). Thresholds come from the existing
`getMarginLevel`, so a snack and a menu item are judged by the same ruler.

Margin is deliberately blank rather than 0% when the buy price is unset:
arithmetic would score that a perfect 100%, which is the exact opposite of the
truth.
