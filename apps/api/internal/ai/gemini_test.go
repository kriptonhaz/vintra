package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGeminiProvider_Complete(t *testing.T) {
	t.Run("success — mixed history translates roles", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var req geminiReq
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				t.Errorf("decode body: %v", err)
			}
			if req.SystemInstruction == nil {
				t.Error("expected systemInstruction")
			}
			wantRoles := []string{"user", "model", "user"}
			for i, c := range req.Contents {
				if i < len(wantRoles) && c.Role != wantRoles[i] {
					t.Errorf("content[%d].role = %q, want %q", i, c.Role, wantRoles[i])
				}
			}

			_ = json.NewEncoder(w).Encode(map[string]any{
				"candidates": []map[string]any{
					{
						"content": map[string]any{
							"parts": []map[string]any{{"text": "Tentu, ada yang bisa saya bantu!"}},
						},
					},
				},
				"usageMetadata": map[string]any{
					"promptTokenCount":     80,
					"candidatesTokenCount": 15,
				},
			})
		}))
		defer srv.Close()

		p := &GeminiProvider{
			apiKey: "test-key",
			client: &http.Client{Transport: localTransport(srv)},
		}
		out, err := p.Complete(context.Background(), CompleteInput{
			Model: "gemini-1.5-flash",
			Messages: []Message{
				{Role: "system", Content: "Kamu CS yang ramah."},
				{Role: "user", Content: "halo"},
				{Role: "assistant", Content: "Halo!"},
				{Role: "user", Content: "ada promo?"},
			},
			Temperature: 0.7,
		})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if out.Text == "" {
			t.Error("expected non-empty text")
		}
		if out.Usage.InputTokens != 80 {
			t.Errorf("input tokens: got %d, want 80", out.Usage.InputTokens)
		}
	})

	t.Run("403 returns ProviderError with Provider=gemini", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"error":{"message":"API key not valid"}}`))
		}))
		defer srv.Close()

		p := &GeminiProvider{
			apiKey: "bad",
			client: &http.Client{Transport: localTransport(srv)},
		}
		_, err := p.Complete(context.Background(), CompleteInput{
			Model:    "gemini-1.5-flash",
			Messages: []Message{{Role: "user", Content: "hi"}},
		})
		pe, ok := err.(*ProviderError)
		if !ok {
			t.Fatalf("expected *ProviderError, got %T: %v", err, err)
		}
		if pe.Provider != "gemini" {
			t.Errorf("provider: got %q, want %q", pe.Provider, "gemini")
		}
		if pe.Status != 403 {
			t.Errorf("status: got %d, want 403", pe.Status)
		}
	})
}
