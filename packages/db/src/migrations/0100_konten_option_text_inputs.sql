-- Konten prompt-field options can now declare free-text inputs that the
-- tenant fills in when the option is picked (e.g. headline / subheadline
-- / CTA for the "use my own text" option). The option's prompt_fragment
-- references the typed values with `{key}` tokens substituted at gen time.
--
-- Also seeds the "Pakai teks saya" option for the text_overlay field —
-- AI handles placement, but the actual copy comes from the tenant.
--
-- Rollback:
--   DELETE FROM "konten_prompt_field_options"
--     WHERE label = 'Pakai teks saya' AND field_id IN
--       (SELECT id FROM "konten_prompt_fields" WHERE key = 'text_overlay');
--   ALTER TABLE "konten_prompt_field_options" DROP COLUMN "text_inputs";

ALTER TABLE "konten_prompt_field_options" ADD COLUMN IF NOT EXISTS "text_inputs" jsonb;
--> statement-breakpoint
INSERT INTO "konten_prompt_field_options" ("field_id", "label", "prompt_fragment", "text_inputs", "sort_order")
SELECT id,
  'Pakai teks saya',
  'Add a marketing text overlay rendering EXACTLY these texts, placed automatically in a balanced composition (no extra text invented):
- Headline: "{headline}"
- Subheadline: "{subheadline}"
- CTA: "{cta}"
Use an elegant, clean typographic style, leave clean negative space for the text, and never render a commercial font name as literal text.',
  '[
    {"key":"headline","label":"Judul","placeholder":"mis. Kopi Nikmat Setiap Hari","maxLength":60},
    {"key":"subheadline","label":"Sub-judul","placeholder":"Penjelasan singkat manfaat produk","multiline":true,"maxLength":120},
    {"key":"cta","label":"Tombol Ajakan (CTA)","placeholder":"mis. Pesan Sekarang","maxLength":30}
  ]'::jsonb,
  2
FROM "konten_prompt_fields"
WHERE "key" = 'text_overlay';
