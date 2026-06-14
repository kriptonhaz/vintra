---
"@vintra/web": minor
---

Add per-section background color to the Situs builder (Framer/WordPress-style). Content sections (Belanja Online, Layanan & Harga, Tentang Kami, Cabang, Jam Buka, Galeri, Promo, Stamp) gain a "Warna latar section" color picker. Pick any hex to set the section background (empty = built-in default). Text auto-adjusts to light on dark backgrounds for readability, while text inside light cards (product cards, search box) stays dark. Shared `section-bg` helper + a scoped CSS contrast block; brand/gradient sections (Hero, CTA, Contact) and system/utility sections (Footer, Maps, Queue) are intentionally excluded.
