package rag

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
)

// fakeTool builds a minimal tool row for dispatch tests. We only set
// the fields Retrieve actually reads — the DB-bound columns are
// irrelevant since the trigger gate keeps us out of the retriever path.
func fakeTool(name, retrievalType, minTier, triggerMode string, keywords []string) queries.GetInstanceEnabledRagToolsRow {
	return queries.GetInstanceEnabledRagToolsRow{
		Name:            name,
		RetrievalType:   retrievalType,
		MinTier:         minTier,
		TriggerMode:     triggerMode,
		TriggerKeywords: keywords,
		Enabled:         true,
	}
}

// TestRetrieve_FreeTierShortCircuits asserts that an empty currentTier
// returns immediately with no snippets and no DB access. This is the
// "free tier" path — passing a nil DB would panic if any retriever ran.
func TestRetrieve_FreeTierShortCircuits(t *testing.T) {
	tools := []queries.GetInstanceEnabledRagToolsRow{
		fakeTool("Harga", "inventory_price", "basic", "always", nil),
	}
	got, err := Retrieve(context.Background(), nil, pgtype.UUID{}, "", "", "halo", "halo", tools, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected no snippets for free tier, got %d", len(got))
	}
}

// TestRetrieve_TierGateFiltersAll asserts that when every tool requires
// a higher tier than the current one, the retrievers never run. Same
// nil-DB assertion as the free tier test.
func TestRetrieve_TierGateFiltersAll(t *testing.T) {
	tools := []queries.GetInstanceEnabledRagToolsRow{
		fakeTool("Loyalty", "loyalty_points", "komplit", "on_customer_match", nil),
		fakeTool("Promo", "promotions", "enterprise", "always", nil),
	}
	got, err := Retrieve(context.Background(), nil, pgtype.UUID{}, "basic", "628xxx", "halo", "halo", tools, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected tier gate to skip all tools, got %d snippets", len(got))
	}
}

// TestRetrieve_KeywordTriggerFiltersBody asserts on_keyword tools are
// skipped when the body has none of the trigger keywords.
func TestRetrieve_KeywordTriggerFiltersBody(t *testing.T) {
	tools := []queries.GetInstanceEnabledRagToolsRow{
		fakeTool("Harga", "inventory_price", "basic", "on_keyword", []string{"harga", "berapa"}),
	}
	got, err := Retrieve(context.Background(), nil, pgtype.UUID{}, "basic", "", "terima kasih", "terima kasih", tools, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected keyword gate to skip tool when message has no keywords, got %d", len(got))
	}
}

// TestRetrieve_CustomerMatchSkipsWithoutJID asserts on_customer_match
// tools are skipped when remoteJid is empty (preview without a JID,
// or a contact we don't have a number for).
func TestRetrieve_CustomerMatchSkipsWithoutJID(t *testing.T) {
	tools := []queries.GetInstanceEnabledRagToolsRow{
		fakeTool("Loyalty", "loyalty_points", "komplit", "on_customer_match", nil),
	}
	got, err := Retrieve(context.Background(), nil, pgtype.UUID{}, "komplit", "", "halo", "halo", tools, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected on_customer_match tool to skip without remoteJid, got %d", len(got))
	}
}

// TestRetrieve_UnknownTypeSkippedSafely asserts a tool with an unknown
// retrieval_type (e.g. seeded by an admin from a future Go version)
// logs a warning and continues — never panics.
func TestRetrieve_UnknownTypeSkippedSafely(t *testing.T) {
	tools := []queries.GetInstanceEnabledRagToolsRow{
		fakeTool("Future", "weather_forecast", "basic", "always", nil),
	}
	got, err := Retrieve(context.Background(), nil, pgtype.UUID{}, "basic", "", "halo", "halo", tools, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected unknown retrieval_type to be skipped, got %d", len(got))
	}
}

// TestRetrieve_PreCanceledContextReturnsEmpty asserts that a context
// canceled before Retrieve runs does not block on goroutines.
func TestRetrieve_PreCanceledContextReturnsEmpty(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	tools := []queries.GetInstanceEnabledRagToolsRow{
		fakeTool("Harga", "inventory_price", "basic", "on_keyword", []string{"halo"}),
	}
	// Should return without panicking. The retriever may run inside its
	// own short-lived ctx and fail with context.Canceled, but Retrieve
	// swallows the error per the "RAG is enriching, not critical" rule.
	got, err := Retrieve(ctx, nil, pgtype.UUID{}, "basic", "", "halo", "halo", tools, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	_ = got
}
