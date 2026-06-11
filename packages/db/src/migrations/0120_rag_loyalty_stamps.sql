-- Extend retrieval_type CHECK to allow the 10th tool (loyalty_stamps) — the
-- WhatsApp bot can now answer "berapa stempel saya?" by joining the
-- customer's known phone to customer_stamp_cards.
ALTER TABLE "wa_rag_tools" DROP CONSTRAINT "wa_rag_tools_retrieval_type_chk";
--> statement-breakpoint
ALTER TABLE "wa_rag_tools" ADD CONSTRAINT "wa_rag_tools_retrieval_type_chk"
  CHECK (retrieval_type IN (
    'inventory_price','inventory_stock','store_address','operating_hours',
    'payment_methods','promotions','loyalty_points','loyalty_stamps',
    'order_history','recipe_availability'
  ));
--> statement-breakpoint

-- Seed the new tool. on_customer_match mirrors loyalty_points — there's
-- nothing useful to retrieve unless the inbound JID is already linked to
-- a customer row. Komplit tier because stamp programs themselves are
-- gated to Komplit on the POS side.
INSERT INTO "wa_rag_tools" ("name", "description", "retrieval_type", "min_tier", "trigger_mode", "trigger_keywords", "sort_order") VALUES
  ('Kartu Stempel',
   'Progres kartu stempel pelanggan yang dikenal (jumlah stempel terkumpul + sisa untuk hadiah).',
   'loyalty_stamps',
   'komplit',
   'on_customer_match',
   ARRAY[]::text[],
   75)
ON CONFLICT DO NOTHING;
