-- Extend retrieval_type CHECK to allow the 9th tool (recipe_availability).
ALTER TABLE "wa_rag_tools" DROP CONSTRAINT "wa_rag_tools_retrieval_type_chk";
--> statement-breakpoint
ALTER TABLE "wa_rag_tools" ADD CONSTRAINT "wa_rag_tools_retrieval_type_chk"
  CHECK (retrieval_type IN (
    'inventory_price','inventory_stock','store_address','operating_hours',
    'payment_methods','promotions','loyalty_points','order_history',
    'recipe_availability'
  ));
--> statement-breakpoint

-- Seed the new tool. Trigger keywords overlap with Stok Barang because UMKM
-- customers ask "ada teh?" / "bisa pesan teh susu?" without distinguishing
-- between directly-stocked goods and recipe-based menu items. Both tools
-- fire on the same words; admins can prune per tenant if noise becomes an issue.
INSERT INTO "wa_rag_tools" ("name", "description", "retrieval_type", "min_tier", "trigger_mode", "trigger_keywords", "sort_order") VALUES
  ('Ketersediaan Menu',
   'Cek apakah menu/produk olahan bisa dibuat berdasarkan stok bahan baku (resep HPP). Juga sumber harga untuk produk berbasis resep — inventory_price tidak menampilkan resep, jadi keyword harga harus ada di sini juga.',
   'recipe_availability',
   'basic',
   'on_keyword',
   ARRAY['ada','stok','tersedia','ready','bisa','pesan','order','menu','harga','berapa','biaya','price'],
   25)
ON CONFLICT DO NOTHING;
