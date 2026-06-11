---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Allow inventory items to link to a recipe-backed HPP product (JUR-10 entry point).

Previously the inventory item form only exposed `linkedHppMaterialId` and hardcoded `linkedHppProductId: null` on submit. That meant tenants who built a recipe in HPP (e.g., "Teh Original" with 3 ingredients) had no way to bridge it to a sellable inventory item — so the JUR-10 auto-deduct flow on POS sales never had an entry point.

The create + edit forms now show a three-way "Sumber HPP" picker (Tidak / Bahan baku / Produk jadi). Picking "Produk jadi" surfaces all HPP products plus an ingredient-count badge so the cashier knows the recipe is wired. The DB already enforced mutual exclusion via `product_materials_xor_chk`; the radio just makes the choice visible. The server-side `listInventoryFormMasters` now returns `hppProducts` alongside `hppMaterials`.
