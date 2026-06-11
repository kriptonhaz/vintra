---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Sidebar IA: split "Stok Barang" into Produk + Inventaris (Qasir-style).

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
