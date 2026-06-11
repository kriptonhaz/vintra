---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Pin the customer slot to the cart header (Restro POS pattern). Previously the "+ Tambah Pelanggan" button lived inside the scrollable middle, below the items list — on long carts (or even the empty state) the cashier had to scroll past the items to see it. Now it sits in its own non-scrolling row directly under the cart title bar, always visible.
