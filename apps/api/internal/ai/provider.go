// Package ai provides a provider-agnostic interface for LLM completions.
//
// The call chain is:
//
//	Handler → Service.Complete → AiProvider.Complete → HTTP (OpenAI/Gemini)
//	                  ↓
//	           UsageRecorder.Record → ai_usage_logs table
//
// Adapters live in openai.go and gemini.go. Neither imports an SDK —
// both use plain net/http to keep the binary small and avoid SDK version
// churn.
package ai

import "context"

// Message is a single turn in a conversation, following the OpenAI
// role convention. Gemini maps "assistant" → "model" internally.
type Message struct {
	Role    string // "system" | "user" | "assistant"
	Content string
}

// CompleteInput is the provider-agnostic request shape.
type CompleteInput struct {
	Model           string
	Messages        []Message
	Temperature     float64
	MaxOutputTokens int // defaults to 512 when zero
	// Optional per-call pricing override (USD per 1M tokens). When BOTH
	// InputPricePer1MUsd and OutputPricePer1MUsd are > 0, adapters use
	// these instead of the hardcoded ai/pricing.go table. Set from the
	// resolved ai_provider_configs row so admins can price custom/unknown
	// models (DeepSeek, Groq, OpenRouter) without shipping a Go release.
	//
	// For DeepSeek-style providers with prompt-caching, also set
	// InputCacheHitPricePer1MUsd to the (cheaper) cache-hit rate. The
	// adapter then reads `prompt_cache_hit_tokens` /
	// `prompt_cache_miss_tokens` from the API response and bills each at
	// its own rate. When InputCacheHitPricePer1MUsd is 0, all input
	// tokens are billed at the InputPricePer1MUsd rate (correct behavior
	// for OpenAI/Gemini official models which don't expose the split).
	InputPricePer1MUsd         float64
	InputCacheHitPricePer1MUsd float64
	OutputPricePer1MUsd        float64
}

// Usage carries token counts and computed cost for one API call.
type Usage struct {
	InputTokens  int
	OutputTokens int
	CostUSD      string // decimal string, e.g. "0.000450" — ready for DB
}

// CompleteOutput is the successful response from a provider.
type CompleteOutput struct {
	Text  string
	Usage Usage
}

// AiProvider is the seam every adapter must implement.
type AiProvider interface {
	// Name returns the canonical provider identifier ("openai" | "gemini").
	Name() string
	// Complete sends the conversation to the upstream API and returns the
	// assistant's reply and token usage. Errors are *ProviderError for
	// non-2xx responses; other errors are network/context failures.
	Complete(ctx context.Context, in CompleteInput) (*CompleteOutput, error)
}
