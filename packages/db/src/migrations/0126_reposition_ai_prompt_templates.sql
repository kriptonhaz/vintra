-- Brand repositioning: drop the "UMKM" framing from the seeded AI prompt
-- templates so generated logos, banners, and marketing images stop
-- steering toward a micro-business aesthetic.
--
-- Data-only. REPLACE() is a no-op for any admin-customized template that
-- no longer contains the original phrase, so custom prompts are safe.

UPDATE "logo_settings"
  SET "prompt_template" = REPLACE("prompt_template", 'Indonesian UMKM brands', 'Indonesian brands');

UPDATE "spanduk_settings"
  SET "prompt_template" = REPLACE("prompt_template", 'Indonesian UMKM banners', 'Indonesian business banners');

UPDATE "konten_settings"
  SET "prompt_template" = REPLACE("prompt_template", 'Indonesian UMKM products', 'Indonesian products');
