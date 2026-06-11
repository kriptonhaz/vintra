package ai

import (
	"strings"

	"github.com/kriptonhaz/vintra/apps/api/internal/conversation"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/rag"
)

const defaultSystemPrompt = "Anda asisten CS yang ramah, jawab singkat dalam Bahasa Indonesia"

// BuildInput carries the data the prompt builder needs to assemble a
// complete chat history for the AI adapter.
type BuildInput struct {
	Instance     queries.WaInstance
	Tenant       queries.Tenant
	History      []conversation.Message
	IncomingBody string
	// Retrieved holds RAG snippets to inject as a system context block.
	// Empty slice = no Konteks block injected (free tier or no tools enabled).
	Retrieved []rag.Snippet
}

// Build assembles a []Message in the order:
//  1. System prompt (instance config or default)
//  2. Business context line ("Bisnis: {name}, kategori: {category}")
//  3. RAG context block (when Retrieved is non-empty)
//  4. Conversation history (fromMe=true → "assistant", else "user")
//  5. The new incoming message as "user"
func Build(in BuildInput) []Message {
	msgs := make([]Message, 0, len(in.History)+4)

	// System prompt — use configured value or fall back to default.
	systemPrompt := defaultSystemPrompt
	if in.Instance.AiSystemPrompt.Valid && strings.TrimSpace(in.Instance.AiSystemPrompt.String) != "" {
		systemPrompt = in.Instance.AiSystemPrompt.String
	}
	msgs = append(msgs, Message{Role: "system", Content: systemPrompt})

	// Business context — helps the AI address the right business type.
	ctx := "Bisnis: " + in.Tenant.BusinessName
	if in.Tenant.BusinessCategory.Valid && in.Tenant.BusinessCategory.String != "" {
		ctx += ", kategori: " + in.Tenant.BusinessCategory.String
	}
	msgs = append(msgs, Message{Role: "system", Content: ctx})

	// RAG context block — injected before conversation history so the model
	// sees fresh data before interpreting the conversation.
	if len(in.Retrieved) > 0 {
		var sb strings.Builder
		sb.WriteString("Konteks dari sistem (gunakan jika relevan):")
		for _, s := range in.Retrieved {
			sb.WriteString("\n- ")
			sb.WriteString(s.Text)
		}
		msgs = append(msgs, Message{Role: "system", Content: sb.String()})
	}

	// Historical turns.
	for _, m := range in.History {
		role := "user"
		if m.FromMe {
			role = "assistant"
		}
		if m.Content != "" {
			msgs = append(msgs, Message{Role: role, Content: m.Content})
		}
	}

	// The new incoming message.
	if in.IncomingBody != "" {
		msgs = append(msgs, Message{Role: "user", Content: in.IncomingBody})
	}

	return msgs
}

// TruncateToBudget drops the oldest user/assistant turns (preserving
// system messages) until the char-based token estimate is within
// maxInputTokens (using 4 chars ≈ 1 token as the approximation).
// System messages at index 0 and 1 are always kept.
func TruncateToBudget(messages []Message, maxInputTokens int) []Message {
	for estimateTokens(messages) > maxInputTokens {
		// Find the first non-system message to drop (index 0,1 are system).
		dropped := false
		for i := 2; i < len(messages); i++ {
			if messages[i].Role != "system" {
				messages = append(messages[:i], messages[i+1:]...)
				dropped = true
				break
			}
		}
		if !dropped {
			break // nothing left to drop
		}
	}
	return messages
}

func estimateTokens(messages []Message) int {
	total := 0
	for _, m := range messages {
		total += len(m.Content) / 4
	}
	return total
}

// EstimateTokens returns a rough token count for a string using the 4-char heuristic.
func EstimateTokens(s string) int { return len(s) / 4 }
