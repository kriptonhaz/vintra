package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const openaiDefaultBase = "https://api.openai.com/v1"

// OpenAIProvider implements AiProvider via the OpenAI chat completions
// REST API (or any OpenAI-compatible endpoint). No SDK — plain net/http.
type OpenAIProvider struct {
	apiKey  string
	baseURL string // base without trailing slash, e.g. https://api.openai.com/v1
	client  *http.Client
}

// NewOpenAI returns an OpenAI adapter using the default api.openai.com endpoint.
func NewOpenAI(apiKey string) *OpenAIProvider {
	return &OpenAIProvider{
		apiKey:  apiKey,
		baseURL: openaiDefaultBase,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// NewOpenAIWithConfig returns an OpenAI-compatible adapter with a custom
// base URL. Use for platform-configured providers (Ollama, Azure, etc.).
func NewOpenAIWithConfig(baseURL, apiKey string) *OpenAIProvider {
	if baseURL == "" {
		baseURL = openaiDefaultBase
	}
	return &OpenAIProvider{
		apiKey:  apiKey,
		baseURL: baseURL,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *OpenAIProvider) Name() string { return "openai" }

type openAIReq struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	Temperature float64         `json:"temperature"`
	MaxTokens   int             `json:"max_tokens"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIResp struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		// DeepSeek extension to the OpenAI usage shape — splits prompt
		// tokens by cache tier so the caller can bill at separate rates.
		// Other OpenAI-compatible providers (Groq, Mistral, OpenRouter)
		// don't emit these and the fields stay zero — which is fine,
		// PriceForOverride degrades to the single-rate formula.
		PromptCacheHitTokens  int `json:"prompt_cache_hit_tokens"`
		PromptCacheMissTokens int `json:"prompt_cache_miss_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (p *OpenAIProvider) Complete(ctx context.Context, in CompleteInput) (*CompleteOutput, error) {
	if p.apiKey == "" {
		return nil, &ProviderError{Provider: "openai", Status: 0, Body: "OPENAI_API_KEY not configured"}
	}

	maxTokens := in.MaxOutputTokens
	if maxTokens == 0 {
		maxTokens = 512
	}

	msgs := make([]openAIMessage, len(in.Messages))
	for i, m := range in.Messages {
		msgs[i] = openAIMessage{Role: m.Role, Content: m.Content}
	}

	body, err := json.Marshal(openAIReq{
		Model:       in.Model,
		Messages:    msgs,
		Temperature: in.Temperature,
		MaxTokens:   maxTokens,
	})
	if err != nil {
		return nil, fmt.Errorf("openai: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("openai: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai: do request: %w", err)
	}
	defer resp.Body.Close()

	rawBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &ProviderError{Provider: "openai", Status: resp.StatusCode, Body: string(rawBody)}
	}

	var out openAIResp
	if err := json.Unmarshal(rawBody, &out); err != nil {
		return nil, fmt.Errorf("openai: decode response: %w", err)
	}
	if len(out.Choices) == 0 {
		return nil, &ProviderError{Provider: "openai", Status: resp.StatusCode, Body: "empty choices"}
	}

	text := out.Choices[0].Message.Content
	in_ := out.Usage.PromptTokens
	out_ := out.Usage.CompletionTokens
	cacheHit := out.Usage.PromptCacheHitTokens

	cost := PriceForOverride(
		in.InputPricePer1MUsd,
		in.InputCacheHitPricePer1MUsd,
		in.OutputPricePer1MUsd,
		in_, cacheHit, out_,
	)
	if cost == "" {
		cost = PriceFor(in.Model, in_, out_)
	}
	return &CompleteOutput{
		Text: text,
		Usage: Usage{
			InputTokens:  in_,
			OutputTokens: out_,
			CostUSD:      cost,
		},
	}, nil
}
