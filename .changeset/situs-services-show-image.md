---
"@vintra/web": minor
---

The situs "Layanan & Harga" section gains a "Tampilkan foto produk" toggle. When on, grid cards swap the thin colored top-bar for the item's catalog photo (4:3), and list rows show a small square thumbnail at the left. Items without a photo fall back to a brand-colored placeholder so card heights stay uniform. Off by default so existing tenants keep their current menu-board look.

Photos are pulled from `inventory_items.photo_key` and signed with a 7-day TTL inside both the public-site loader and the editor preview, so the same imagery appears in both places.
