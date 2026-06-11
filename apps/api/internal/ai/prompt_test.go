package ai

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/conversation"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/rag"
)

func pgText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: true} }

func TestBuild_FallbackSystemPrompt(t *testing.T) {
	msgs := Build(BuildInput{
		Instance:     queries.WaInstance{},
		Tenant:       queries.Tenant{BusinessName: "Toko Maju"},
		IncomingBody: "halo",
	})

	if msgs[0].Role != "system" {
		t.Fatalf("first message role: got %q, want %q", msgs[0].Role, "system")
	}
	if msgs[0].Content != defaultSystemPrompt {
		t.Errorf("system prompt: got %q, want %q", msgs[0].Content, defaultSystemPrompt)
	}
}

func TestBuild_CustomSystemPrompt(t *testing.T) {
	custom := "Kamu CS toko kelontong yang ramah."
	msgs := Build(BuildInput{
		Instance: queries.WaInstance{
			AiSystemPrompt: pgText(custom),
		},
		Tenant:       queries.Tenant{BusinessName: "Toko Maju"},
		IncomingBody: "mau beli",
	})
	if msgs[0].Content != custom {
		t.Errorf("system prompt: got %q, want %q", msgs[0].Content, custom)
	}
}

func TestBuild_HistoryOrder(t *testing.T) {
	history := []conversation.Message{
		{FromMe: false, Content: "halo"},
		{FromMe: true, Content: "Halo! Ada yang bisa dibantu?"},
		{FromMe: false, Content: "ada promo?"},
	}

	msgs := Build(BuildInput{
		Instance:     queries.WaInstance{},
		Tenant:       queries.Tenant{BusinessName: "Kafe ABC"},
		History:      history,
		IncomingBody: "minta info",
	})

	// [0]=system, [1]=business context, [2]=user, [3]=assistant, [4]=user(history), [5]=user(incoming)
	if msgs[2].Role != "user" || msgs[2].Content != "halo" {
		t.Errorf("history[0]: got {%s %q}", msgs[2].Role, msgs[2].Content)
	}
	if msgs[3].Role != "assistant" {
		t.Errorf("history[1] role: got %q, want assistant", msgs[3].Role)
	}
	last := msgs[len(msgs)-1]
	if last.Role != "user" || last.Content != "minta info" {
		t.Errorf("incoming: got {%s %q}", last.Role, last.Content)
	}
}

func TestTruncateToBudget(t *testing.T) {
	// Build 50 history messages of ~80 chars each.
	history := make([]conversation.Message, 50)
	for i := range history {
		history[i] = conversation.Message{FromMe: i%2 == 1, Content: strings.Repeat("x", 80)}
	}

	msgs := Build(BuildInput{
		Instance:     queries.WaInstance{},
		Tenant:       queries.Tenant{BusinessName: "T"},
		History:      history,
		IncomingBody: "hi",
	})

	truncated := TruncateToBudget(msgs, 3000)

	// System messages must be intact.
	if truncated[0].Role != "system" {
		t.Error("system message removed")
	}
	if truncated[1].Role != "system" {
		t.Error("business context removed")
	}

	// Token estimate must be ≤ budget.
	if estimateTokens(truncated) > 3000 {
		t.Errorf("token estimate %d exceeds budget 3000", estimateTokens(truncated))
	}

	// Messages must remain in order (chronological).
	for i := 2; i < len(truncated)-1; i++ {
		if truncated[i].Role == "system" {
			t.Errorf("system message at index %d after truncation", i)
		}
	}
}

func TestBuild_RAGInjected(t *testing.T) {
	snippets := []rag.Snippet{
		{Text: "Harga: Kopi Robusta — Rp 25.000"},
		{Text: "Stok: Kopi Robusta — 12 pcs"},
	}
	msgs := Build(BuildInput{
		Instance:     queries.WaInstance{},
		Tenant:       queries.Tenant{BusinessName: "Kafe ABC"},
		IncomingBody: "berapa harga kopi?",
		Retrieved:    snippets,
	})
	// [0]=system, [1]=business, [2]=RAG block, [3]=incoming
	if len(msgs) < 3 {
		t.Fatalf("expected at least 3 messages, got %d", len(msgs))
	}
	ragMsg := msgs[2]
	if ragMsg.Role != "system" {
		t.Errorf("RAG block role: got %q, want system", ragMsg.Role)
	}
	if !strings.Contains(ragMsg.Content, "Konteks dari sistem") {
		t.Errorf("RAG block missing header, got: %q", ragMsg.Content)
	}
	if !strings.Contains(ragMsg.Content, "Kopi Robusta") {
		t.Errorf("RAG block missing snippet content")
	}
}

func TestBuild_NoRAGWhenEmpty(t *testing.T) {
	msgs := Build(BuildInput{
		Instance:     queries.WaInstance{},
		Tenant:       queries.Tenant{BusinessName: "Kafe ABC"},
		IncomingBody: "halo",
		Retrieved:    nil,
	})
	for _, m := range msgs {
		if strings.Contains(m.Content, "Konteks dari sistem") {
			t.Error("Konteks block should not appear when Retrieved is empty")
		}
	}
}
