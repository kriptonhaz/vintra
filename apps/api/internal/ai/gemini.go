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

const geminiDefaultBase = "https://generativelanguage.googleapis.com/v1beta"

// GeminiProvider implements AiProvider via Google's Gemini REST API.
// No SDK — plain net/http. Role mapping: "system" → systemInstruction,
// "user"/"assistant" → contents with role "user"/"model".
type GeminiProvider struct {
	apiKey  string
	baseURL string // base without trailing slash
	client  *http.Client
}

// NewGemini returns a Gemini adapter using the default Google endpoint.
func NewGemini(apiKey string) *GeminiProvider {
	return &GeminiProvider{
		apiKey:  apiKey,
		baseURL: geminiDefaultBase,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// NewGeminiWithConfig returns a Gemini adapter with a custom base URL.
func NewGeminiWithConfig(baseURL, apiKey string) *GeminiProvider {
	if baseURL == "" {
		baseURL = geminiDefaultBase
	}
	return &GeminiProvider{
		apiKey:  apiKey,
		baseURL: baseURL,
		client:  &http.Client{Timeout: 30 * time.Second},
	}
}

func (p *GeminiProvider) Name() string { return "gemini" }

type geminiReq struct {
	SystemInstruction *geminiContent   `json:"systemInstruction,omitempty"`
	Contents          []geminiContent  `json:"contents"`
	GenerationConfig  geminiGenConfig  `json:"generationConfig"`
}

type geminiContent struct {
	Role  string        `json:"role,omitempty"`
	Parts []geminiPart  `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiGenConfig struct {
	Temperature     float64 `json:"temperature"`
	MaxOutputTokens int     `json:"maxOutputTokens"`
}

type geminiResp struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	UsageMetadata struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
	} `json:"usageMetadata"`
}

func (p *GeminiProvider) Complete(ctx context.Context, in CompleteInput) (*CompleteOutput, error) {
	if p.apiKey == "" {
		return nil, &ProviderError{Provider: "gemini", Status: 0, Body: "GEMINI_API_KEY not configured"}
	}

	maxTokens := in.MaxOutputTokens
	if maxTokens == 0 {
		maxTokens = 512
	}

	req := geminiReq{
		GenerationConfig: geminiGenConfig{
			Temperature:     in.Temperature,
			MaxOutputTokens: maxTokens,
		},
	}

	for _, m := range in.Messages {
		switch m.Role {
		case "system":
			req.SystemInstruction = &geminiContent{
				Parts: []geminiPart{{Text: m.Content}},
			}
		case "user":
			req.Contents = append(req.Contents, geminiContent{
				Role:  "user",
				Parts: []geminiPart{{Text: m.Content}},
			})
		case "assistant":
			req.Contents = append(req.Contents, geminiContent{
				Role:  "model",
				Parts: []geminiPart{{Text: m.Content}},
			})
		}
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("gemini: marshal request: %w", err)
	}

	url := fmt.Sprintf("%s/models/%s:generateContent?key=%s", p.baseURL, in.Model, p.apiKey)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("gemini: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("gemini: do request: %w", err)
	}
	defer resp.Body.Close()

	rawBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &ProviderError{Provider: "gemini", Status: resp.StatusCode, Body: string(rawBody)}
	}

	var out geminiResp
	if err := json.Unmarshal(rawBody, &out); err != nil {
		return nil, fmt.Errorf("gemini: decode response: %w", err)
	}
	if len(out.Candidates) == 0 || len(out.Candidates[0].Content.Parts) == 0 {
		return nil, &ProviderError{Provider: "gemini", Status: resp.StatusCode, Body: "empty candidates"}
	}

	text := out.Candidates[0].Content.Parts[0].Text
	inTok := out.UsageMetadata.PromptTokenCount
	outTok := out.UsageMetadata.CandidatesTokenCount

	// Gemini doesn't expose cache-tier token splits, so we always pass
	// 0 for cache-hit tokens — PriceForOverride degrades to the simple
	// two-rate formula. If Gemini ships caching pricing later, parse the
	// split here.
	cost := PriceForOverride(
		in.InputPricePer1MUsd,
		in.InputCacheHitPricePer1MUsd,
		in.OutputPricePer1MUsd,
		inTok, 0, outTok,
	)
	if cost == "" {
		cost = PriceFor(in.Model, inTok, outTok)
	}
	return &CompleteOutput{
		Text: text,
		Usage: Usage{
			InputTokens:  inTok,
			OutputTokens: outTok,
			CostUSD:      cost,
		},
	}, nil
}
