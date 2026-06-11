---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Add category grouping and numbered pagination to the public site "Layanan & Harga" section. Two new editor toggles: "Kelompokkan per kategori" renders products under category headings (pulled from inventory categories), and "Aktifkan halaman" splits a long catalog into numbered pages with a configurable items-per-page count. Both compose — a paginated slice still shows headings when the category changes within it.
