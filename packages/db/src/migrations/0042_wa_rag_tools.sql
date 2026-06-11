-- Add business_hours to branches (customer-facing store hours, distinct from staff schedules)
ALTER TABLE "branches" ADD COLUMN "business_hours" jsonb;
--> statement-breakpoint

-- RAG tool definitions (platform-managed)
CREATE TABLE "wa_rag_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "retrieval_type" text NOT NULL,
  "min_tier" text NOT NULL DEFAULT 'basic',
  "trigger_mode" text NOT NULL DEFAULT 'always',
  "trigger_keywords" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "wa_rag_tools_retrieval_type_chk" CHECK (retrieval_type IN ('inventory_price','inventory_stock','store_address','operating_hours','payment_methods','promotions','loyalty_points','order_history')),
  CONSTRAINT "wa_rag_tools_min_tier_chk" CHECK (min_tier IN ('basic','komplit','enterprise')),
  CONSTRAINT "wa_rag_tools_trigger_mode_chk" CHECK (trigger_mode IN ('always','on_keyword','on_customer_match'))
);
--> statement-breakpoint

-- Per-instance RAG tool opt-in (default false = opt-in model)
CREATE TABLE "wa_instance_rag_tools" (
  "instance_id" uuid NOT NULL REFERENCES "wa_instances"("id") ON DELETE CASCADE,
  "rag_tool_id" uuid NOT NULL REFERENCES "wa_rag_tools"("id") ON DELETE CASCADE,
  "enabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "wa_instance_rag_tools_pk" PRIMARY KEY ("instance_id", "rag_tool_id")
);
--> statement-breakpoint

-- Seed 8 default tools
INSERT INTO "wa_rag_tools" ("name", "description", "retrieval_type", "min_tier", "trigger_mode", "trigger_keywords", "sort_order") VALUES
  ('Harga Barang',      'Cari harga produk dari katalog inventaris',          'inventory_price',  'basic',   'on_keyword',        ARRAY['harga','berapa','biaya','price'],                                          10),
  ('Stok Barang',       'Cek ketersediaan stok produk',                       'inventory_stock',  'basic',   'on_keyword',        ARRAY['stok','ada','tersedia','ready'],                                           20),
  ('Alamat Toko',       'Informasi lokasi dan alamat toko',                   'store_address',    'basic',   'on_keyword',        ARRAY['alamat','lokasi','dimana','maps'],                                         30),
  ('Jam Operasional',   'Jam buka dan tutup toko',                            'operating_hours',  'basic',   'on_keyword',        ARRAY['jam','buka','tutup','operasional','jadwal'],                               40),
  ('Metode Pembayaran', 'Metode pembayaran yang diterima',                    'payment_methods',  'basic',   'on_keyword',        ARRAY['bayar','payment','transfer','qris','tunai','cash','dana','gopay','ovo','shopeepay'], 50),
  ('Promo',             'Promosi dan diskon yang sedang aktif',               'promotions',       'komplit', 'always',            ARRAY[]::text[],                                                                 60),
  ('Loyalty Point',     'Saldo poin loyalitas pelanggan yang dikenal',        'loyalty_points',   'komplit', 'on_customer_match', ARRAY[]::text[],                                                                 70),
  ('Riwayat Pesanan',   'Riwayat transaksi pelanggan yang dikenal',           'order_history',    'komplit', 'on_customer_match', ARRAY[]::text[],                                                                 80)
ON CONFLICT DO NOTHING;
