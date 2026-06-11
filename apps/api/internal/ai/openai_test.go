package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// testTransport redirects all requests to a local httptest.Server URL.
type testTransport struct {
	host      string
	transport http.RoundTripper
}

func (rt testTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req2 := req.Clone(req.Context())
	req2.URL.Scheme = "http"
	req2.URL.Host = rt.host
	return rt.transport.RoundTrip(req2)
}

func localTransport(srv *httptest.Server) http.RoundTripper {
	return testTransport{
		host:      srv.Listener.Addr().String(),
		transport: srv.Client().Transport,
	}
}

func TestOpenAIProvider_Complete(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") == "" {
				t.Error("missing Authorization header")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{"message": map[string]any{"content": "Halo! Ada yang bisa saya bantu?"}},
				},
				"usage": map[string]any{
					"prompt_tokens":     100,
					"completion_tokens": 20,
				},
			})
		}))
		defer srv.Close()

		p := &OpenAIProvider{
			apiKey: "test-key",
			client: &http.Client{Transport: localTransport(srv)},
		}
		out, err := p.Complete(context.Background(), CompleteInput{
			Model:       "gpt-4o-mini",
			Messages:    []Message{{Role: "user", Content: "halo"}},
			Temperature: 0.7,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if out.Text == "" {
			t.Error("expected non-empty text")
		}
		if out.Usage.InputTokens != 100 {
			t.Errorf("input tokens: got %d, want 100", out.Usage.InputTokens)
		}
		if out.Usage.OutputTokens != 20 {
			t.Errorf("output tokens: got %d, want 20", out.Usage.OutputTokens)
		}
		if out.Usage.CostUSD == "" {
			t.Error("expected non-empty CostUSD")
		}
	})

	t.Run("401 returns ProviderError", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"Invalid API Key"}}`))
		}))
		defer srv.Close()

		p := &OpenAIProvider{
			apiKey: "bad-key",
			client: &http.Client{Transport: localTransport(srv)},
		}
		_, err := p.Complete(context.Background(), CompleteInput{
			Model:    "gpt-4o-mini",
			Messages: []Message{{Role: "user", Content: "hi"}},
		})
		if err == nil {
			t.Fatal("expected error")
		}
		pe, ok := err.(*ProviderError)
		if !ok {
			t.Fatalf("expected *ProviderError, got %T", err)
		}
		if pe.Status != 401 {
			t.Errorf("status: got %d, want 401", pe.Status)
		}
	})

	t.Run("missing API key returns ProviderError", func(t *testing.T) {
		p := &OpenAIProvider{apiKey: "", client: http.DefaultClient}
		_, err := p.Complete(context.Background(), CompleteInput{
			Model:    "gpt-4o-mini",
			Messages: []Message{{Role: "user", Content: "hi"}},
		})
		pe, ok := err.(*ProviderError)
		if !ok {
			t.Fatalf("expected *ProviderError, got %T", err)
		}
		if pe.Provider != "openai" {
			t.Errorf("provider: got %q, want %q", pe.Provider, "openai")
		}
	})
}
