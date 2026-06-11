-- Update the Konten guided-mode prompt template to actually consume
-- the four visual-composition fields shipped in 0111 + 0112
-- (camera_angle, lighting, background_scene, subjek).
--
-- Bug being fixed: the previous template only referenced four slots
-- ({target_market}, {target_platform}, {objective}, {text_overlay}).
-- The assembly loop in apps/web/src/server/functions/konten.ts only
-- substitutes keys that appear in the template, so the four new fields
-- were silently dropped — users saw them in the form, the model never
-- did. Picking "Close-up Detail" or "Sore Keemasan" had no effect.
--
-- Also restructures the template so explicit user choices override
-- the model's defaults. The previous template told the model to
-- "decide every creative choice from what you see," which conflicts
-- with explicit composition instructions — the model would arbitrarily
-- pick one or the other, producing the same baseline look that
-- prompted the new fields in the first place. The new wording slots
-- user choices under "Style direction (apply every instruction below
-- — they override your defaults)" with a fallback paragraph that
-- kicks in only when the user leaves the slots empty.
--
-- Rollback: restore the previous template by re-running migration 0099
-- followed by 0100 if those were the original sources of this row, or
-- UPDATE konten_settings SET prompt_template = '<previous text>'.

UPDATE "konten_settings"
   SET "prompt_template" = $$You are an expert AI product photographer and visual marketing strategist for Indonesian UMKM products. Transform the provided product photo into ONE polished, ready-to-publish marketing image.

PRODUCT INTEGRITY — CRITICAL: keep the product's real shape, colors, materials, textures and packaging exactly as in the source photo. Reproduce a visible logo faithfully; if there is no logo, render none and never invent one. Clean up plastic wrap, price/size stickers, dirty backgrounds, harsh flat lighting and clutter.

Style direction (apply every instruction below — they override your defaults):

{camera_angle}
{lighting}
{background_scene}
{subjek}

Audience and platform context:

{target_market}
{target_platform}
{objective}

When any of the directions above are missing, fall back to your own expert judgment: a tasteful composition with clean negative space, a professional studio look, and a mood that matches the product and the audience.

{text_overlay}$$,
       "updated_at" = now();
