-- DeepSeek (and any future provider with prompt-caching pricing) bills
-- input tokens at two rates: cheap "cache hit" and expensive "cache miss".
-- A single per-1M-input column under-bills tenants by ~40% in practice.
-- Add a third column so we can compute the real cost.
ALTER TABLE "ai_provider_configs"
  ADD COLUMN "input_cache_hit_price_per_1m_usd" numeric(12, 6);
--> statement-breakpoint

COMMENT ON COLUMN "ai_provider_configs"."input_cache_hit_price_per_1m_usd" IS
  'DeepSeek-style cache-hit input pricing in USD per 1M tokens. NULL = treat all input tokens as cache miss (the input_price_per_1m_usd column). When set, the worker reads prompt_cache_hit_tokens / prompt_cache_miss_tokens from the API response and bills each at its own rate.';
--> statement-breakpoint

COMMENT ON COLUMN "ai_provider_configs"."input_price_per_1m_usd" IS
  'Price in USD per 1,000,000 input tokens — interpreted as the CACHE-MISS rate when input_cache_hit_price_per_1m_usd is also set (DeepSeek model). For providers without cache-tier pricing (OpenAI, Gemini), this is just the single input rate.';
