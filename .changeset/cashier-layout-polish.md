---
"@vintra/web": patch
---

Refine the POS cashier layout.

- Out-of-hours + Peti Kas banners now sit inside the product column, so they match the product-list width instead of spanning over the cart. The cart pane reclaims that vertical space (full column height) and gets a brand-tinted highlight border.
- The customer entry point ("Pelanggan") now sits beside "Item Lain" in the cart header. An attached customer shows as a compact header chip on tablet/desktop (≥768px) and as a full-width card (name + phone, plus the loyalty balance + redeem input) on phones, where the header chip truncated the name.
- Fix the cart column overflowing the viewport on narrow screens (added `min-w-0` to the POS columns so they shrink and their content truncates instead of spilling off-screen).
