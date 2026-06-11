package ai

import (
	"context"
	"fmt"
	"time"
)

// Service is the single dispatch point for all AI completion calls in
// the platform. It selects the right adapter by name, calls it, and
// records usage regardless of success or failure.
type Service struct {
	providers map[string]AiProvider
	usage     *UsageRecorder
}

// New builds a Service from the given provider list. Providers are
// indexed by their Name() return value. Panics if two providers share
// a name — that's a programming error, not a runtime one.
func New(providers []AiProvider, usage *UsageRecorder) *Service {
	m := make(map[string]AiProvider, len(providers))
	for _, p := range providers {
		if _, dup := m[p.Name()]; dup {
			panic("ai.New: duplicate provider name: " + p.Name())
		}
		m[p.Name()] = p
	}
	return &Service{providers: m, usage: usage}
}

// Complete dispatches to the named provider from the static registry,
// records usage in ai_usage_logs, and returns the output.
func (s *Service) Complete(ctx context.Context, tenantID, feature, providerName string, in CompleteInput) (*CompleteOutput, error) {
	p, ok := s.providers[providerName]
	if !ok {
		return nil, fmt.Errorf("ai: unknown provider %q", providerName)
	}
	return s.CompleteWith(ctx, tenantID, feature, p, in)
}

// CompleteWith calls the given provider directly, bypassing the name
// registry. Use this when the provider is constructed from a runtime
// config (e.g., a platform-level ai_provider_configs row).
// Usage is always recorded — on error the row has status='error'.
func (s *Service) CompleteWith(ctx context.Context, tenantID, feature string, p AiProvider, in CompleteInput) (*CompleteOutput, error) {
	start := time.Now()
	out, callErr := p.Complete(ctx, in)
	latencyMs := int(time.Since(start).Milliseconds())

	rec := RecordParams{
		TenantID:  tenantID,
		Feature:   feature,
		Provider:  p.Name(),
		Model:     in.Model,
		LatencyMs: latencyMs,
	}

	if callErr != nil {
		rec.Status = "error"
		rec.ErrMsg = callErr.Error()
		rec.CostUSD = "0.000000"
	} else {
		rec.Status = "success"
		rec.InputTokens = out.Usage.InputTokens
		rec.OutputTokens = out.Usage.OutputTokens
		rec.CostUSD = out.Usage.CostUSD
	}

	_, _ = s.usage.Record(ctx, rec)
	return out, callErr
}
