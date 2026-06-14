---
"@vintra/web": minor
"@vintra/db": minor
---

Product variants — Phase 1 (data model + inventory management UI). Inventory items can now define up to 2 variant dimensions (e.g. Ukuran × Warna; names + values are fully seller-defined, with quick-pick presets for Ukuran/Warna). The combination matrix is auto-generated, each combo carrying its own price, optional SKU, and per-branch stock. New schema: `inventory_items.has_variants` + `variant_config`, `inventory_item_variants`, `inventory_item_variant_stock`, and `inventory_movements.variant_id` for the audit ledger. Variant management lives on the item detail page (`VariantManager`). Storefront/cart/checkout integration and POS variant-selling come in later phases.
