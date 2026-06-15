-- Broaden the online_orders_status trigger keywords. The original set only
-- caught "where's my order" phrasing; follow-ups about payment ("total nya
-- berapa dan bayarnya ke mana?") didn't fire the tool because the keyword
-- gate only inspects the current message (not history). Add payment/total
-- terms (substring match, so "total" catches "total nya", "bayar" catches
-- "bayarnya"). Idempotent.
UPDATE "wa_rag_tools"
SET "trigger_keywords" = ARRAY[
  'pesanan','order','orderan','lacak','resi','sampai mana','dikirim',
  'barang saya','status pesanan','total','bayar','rekening','transfer',
  'no rek','nomor rekening'
]::text[]
WHERE "retrieval_type" = 'online_orders_status';
