-- Admin-editable per-1M-token pricing on each provider config. The Go
-- worker reads these instead of the hardcoded ai/pricing.go table when
-- both columns are non-null. Fallback path (NULL columns) keeps the
-- existing OpenAI/Gemini pricing working without backfill.
ALTER TABLE "ai_provider_configs"
  ADD COLUMN "input_price_per_1m_usd" numeric(12, 6),
  ADD COLUMN "output_price_per_1m_usd" numeric(12, 6);
--> statement-breakpoint

COMMENT ON COLUMN "ai_provider_configs"."input_price_per_1m_usd" IS
  'Price in USD per 1,000,000 input tokens. NULL = fall back to hardcoded ai/pricing.go table; useful for unknown/custom models like deepseek-v4-flash.';
--> statement-breakpoint

COMMENT ON COLUMN "ai_provider_configs"."output_price_per_1m_usd" IS
  'Price in USD per 1,000,000 output tokens. NULL = fall back to hardcoded table.';
