---
"@vintra/web": minor
---

Stamp / punch-card editor polish:

- The "Produk yang dihitung" and "Produk hadiah" pickers are now searchable comboboxes — typing filters the active inventory list instead of forcing a long scroll. Same data source as before (the active POS items list).
- **Hapus program** button in the editor footer. Hard delete is allowed only when no customer has earned a stamp on the program; once any history exists the server refuses with a friendly Indonesian message asking the owner to deactivate instead, preserving lifetime stamps + rewards on the customer detail page.
- Programs list paginates at 10 per page. Tenants with a handful of programs (the common case) never see a pager; busier owners get **Sebelumnya / Berikutnya** controls.
