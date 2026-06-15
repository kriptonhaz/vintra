-- 11th RAG tool: online_orders_status. Lets the WhatsApp AI answer
-- "pesanan saya sampai mana?" by matching the buyer's WhatsApp number to
-- their Toko Online orders — so a buyer who lost their order number can
-- still check progress. Scope (in the retriever): in-progress orders +
-- those completed in the last 14 days; cancelled excluded.
ALTER TABLE "wa_rag_tools" DROP CONSTRAINT "wa_rag_tools_retrieval_type_chk";
--> statement-breakpoint
ALTER TABLE "wa_rag_tools" ADD CONSTRAINT "wa_rag_tools_retrieval_type_chk"
  CHECK (retrieval_type IN (
    'inventory_price','inventory_stock','store_address','operating_hours',
    'payment_methods','promotions','loyalty_points','loyalty_stamps',
    'order_history','recipe_availability','online_orders_status'
  ));
--> statement-breakpoint

-- Seed the tool. Keyword-triggered (the buyer must ask about an order),
-- and Komplit tier since Toko Online itself is Komplit-gated. Substring
-- keyword match, so "pesanan" also catches "pesananku"/"pesanan saya".
INSERT INTO "wa_rag_tools" ("name", "description", "retrieval_type", "min_tier", "trigger_mode", "trigger_keywords", "sort_order") VALUES
  ('Status Pesanan Online',
   'Status & progres pesanan Toko Online pelanggan (dicari lewat nomor WhatsApp): nomor pesanan, status, item, total, dan resi.',
   'online_orders_status',
   'komplit',
   'on_keyword',
   ARRAY['pesanan','order','orderan','lacak','resi','sampai mana','dikirim','barang saya','status pesanan']::text[],
   80)
ON CONFLICT DO NOTHING;
