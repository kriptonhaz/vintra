package ai

import "fmt"

// modelPrices holds per-1M-token prices in USD for each supported model.
// Prices sourced from public pricing pages (2025-05-12).
// Update this table when OpenAI/Google change their rates.
var modelPrices = map[string]struct{ in, out float64 }{
	// OpenAI — https://openai.com/api/pricing/
	"gpt-4o-mini": {in: 0.15, out: 0.60},
	"gpt-4o":      {in: 2.50, out: 10.00},

	// Google Gemini — https://ai.google.dev/pricing
	"gemini-1.5-flash": {in: 0.075, out: 0.30},
	"gemini-1.5-pro":   {in: 1.25, out: 5.00},
}

// PriceFor returns the cost in USD for the given token counts as a
// 6-decimal string suitable for storing in numeric(12,6). Returns
// "0.000000" for unknown models — callers still record the row, they
// just lose cost tracking until the table is updated.
func PriceFor(model string, inputTokens, outputTokens int) string {
	p, ok := modelPrices[model]
	if !ok {
		return "0.000000"
	}
	cost := (float64(inputTokens)*p.in + float64(outputTokens)*p.out) / 1_000_000
	return fmt.Sprintf("%.6f", cost)
}

// PriceForOverride mirrors PriceFor but uses caller-supplied per-1M-token
// rates instead of the hardcoded modelPrices table. When BOTH input and
// output rates are > 0, returns the computed cost; otherwise returns
// empty string and the caller is expected to fall back to PriceFor.
//
// `inputCacheHitTokens` is the number of input tokens served from a
// provider-side prompt cache (DeepSeek-style). When > 0 AND
// `inputCacheHitPricePer1M` > 0, those tokens are billed at the cheaper
// cache-hit rate; the rest of the input tokens are billed at the
// (regular / cache-miss) `inputPricePer1M` rate. For providers without
// cache-tier pricing or callers that don't pass the split, set
// `inputCacheHitTokens=0` and `inputCacheHitPricePer1M=0` — the behavior
// then matches the simple two-rate formula.
//
// This is the path admin-set ai_provider_configs price columns take so
// DeepSeek cost tracking is accurate (we under-billed by ~40% before the
// cache-tier split was modeled).
func PriceForOverride(
	inputPricePer1M, inputCacheHitPricePer1M, outputPricePer1M float64,
	inputTokens, inputCacheHitTokens, outputTokens int,
) string {
	if inputPricePer1M <= 0 || outputPricePer1M <= 0 {
		return ""
	}
	// Cache-hit tokens are a SUBSET of total input tokens — never billed
	// twice. Guard against malformed responses where hit > total.
	hit := inputCacheHitTokens
	if hit > inputTokens {
		hit = inputTokens
	}
	miss := inputTokens - hit

	missCost := float64(miss) * inputPricePer1M
	hitCost := 0.0
	if inputCacheHitPricePer1M > 0 && hit > 0 {
		hitCost = float64(hit) * inputCacheHitPricePer1M
	} else {
		// No cache-hit rate configured — bill cache hits at the regular
		// input rate. Mathematically equivalent to ignoring the split.
		missCost = float64(inputTokens) * inputPricePer1M
	}

	cost := (missCost + hitCost + float64(outputTokens)*outputPricePer1M) / 1_000_000
	return fmt.Sprintf("%.6f", cost)
}
