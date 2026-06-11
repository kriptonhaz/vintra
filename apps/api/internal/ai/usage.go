package ai

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
)

// UsageRecorder writes AI call metadata to ai_usage_logs after every
// Complete call, regardless of success or failure.
type UsageRecorder struct {
	q *queries.Queries
}

// NewUsageRecorder constructs a UsageRecorder backed by the given sqlc
// Queries handle.
func NewUsageRecorder(q *queries.Queries) *UsageRecorder {
	return &UsageRecorder{q: q}
}

// RecordParams carries all the fields for one ai_usage_logs row.
type RecordParams struct {
	TenantID     string
	Feature      string // e.g. "wa_reply"
	Provider     string // "openai" | "gemini"
	Model        string
	InputTokens  int
	OutputTokens int
	CostUSD      string // 6-decimal string from PriceFor
	LatencyMs    int    // 0 means not measured
	Status       string // "success" | "error"
	ErrMsg       string // truncated to 500 chars; empty on success
}

// Record inserts one row into ai_usage_logs and returns the new row's
// UUID string. The error path still inserts (with status='error') so
// cost can always be audited.
func (r *UsageRecorder) Record(ctx context.Context, p RecordParams) (string, error) {
	tenantID, err := db.ParseUUID(p.TenantID)
	if err != nil {
		return "", fmt.Errorf("usage recorder: parse tenant id: %w", err)
	}

	var costNum pgtype.Numeric
	if scanErr := costNum.Scan(p.CostUSD); scanErr != nil {
		// Non-fatal: record zero cost rather than skipping the row.
		_ = costNum.Scan("0.000000")
	}

	var latency pgtype.Int4
	if p.LatencyMs > 0 {
		latency = pgtype.Int4{Int32: int32(p.LatencyMs), Valid: true}
	}

	errMsg := p.ErrMsg
	if len(errMsg) > 500 {
		errMsg = errMsg[:500]
	}

	row, err := r.q.RecordAiUsage(ctx, queries.RecordAiUsageParams{
		TenantID:     tenantID,
		Feature:      p.Feature,
		Provider:     p.Provider,
		Model:        p.Model,
		InputTokens:  int32(p.InputTokens),
		OutputTokens: int32(p.OutputTokens),
		CostUsd:      costNum,
		LatencyMs:    latency,
		Status:       p.Status,
		ErrorMessage: pgtype.Text{String: errMsg, Valid: errMsg != ""},
	})
	if err != nil {
		return "", fmt.Errorf("usage recorder: insert: %w", err)
	}

	return db.UUIDString(row.ID), nil
}

// MonthlyCost returns the total cost_usd sum for successful AI calls
// this calendar month, as a decimal string (e.g. "0.004200"). Returns
// "0" for tenants with no rows.
func (r *UsageRecorder) MonthlyCost(ctx context.Context, tenantID string) (string, error) {
	tid, err := db.ParseUUID(tenantID)
	if err != nil {
		return "", fmt.Errorf("usage recorder: parse tenant id: %w", err)
	}

	val, err := r.q.MonthlyAiCost(ctx, tid)
	if err != nil {
		return "", fmt.Errorf("usage recorder: monthly cost: %w", err)
	}
	if val == "" {
		return "0", nil
	}
	return val, nil
}
