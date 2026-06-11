---
"@vintra/web": minor
"@vintra/db": minor
---

Franchise requisition fulfillment now posts to cashflow. When a franchise outlet's stock requisition is fulfilled, the system writes a paired cashflow entry — an `expense` on the outlet and a matching `income` on HQ — for the purchase total (fulfilled quantity × franchise price). Independent-branch transfers stay money-free.

Migration `0097` adds the `stock_requisition` source value to `cashflow_entries` and seeds two system categories ("Pembelian Stok dari Pusat", "Penjualan Stok ke Outlet"). The entries are written inside the fulfillment transaction, so stock movement and cashflow posting commit together.
