// Package auth verifies Supabase access tokens.
//
// We deliberately avoid the supabase-go SDK and call the REST endpoint
// `/auth/v1/user` ourselves. Two reasons:
//   1. supabase-go is less polished than supabase-js — its API surface
//      and error shapes change between versions.
//   2. A single GET with a Bearer header is the entire contract; an
//      SDK adds ~200 KB of deps for code we'd write in 40 lines.
//
// The verifier mutates no state — same instance is safe across
// goroutines. Single HTTP client with a connection pool + 5s timeout
// is reused for every request.
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// User is the subset of the Supabase user payload we actually care
// about. The full response has email, role, app_metadata,
// user_metadata, etc. — we'll add fields here as we need them.
type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// ErrInvalidToken is returned for any 4xx response from the Supabase
// auth endpoint. Callers convert this to 401.
var ErrInvalidToken = errors.New("auth: invalid token")

// Verifier verifies tokens against a Supabase project.
type Verifier struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

// New constructs a verifier pointed at the given Supabase project.
// baseURL should be the project's https URL (no trailing slash);
// apiKey is the server-only secret key.
func New(baseURL, apiKey string) *Verifier {
	return &Verifier{
		baseURL: strings.TrimRight(baseURL, "/"),
		apiKey:  apiKey,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

// Verify returns the User for a valid access token, or ErrInvalidToken
// for any 4xx response. Network/5xx errors are returned wrapped so the
// caller can distinguish "user is unauthenticated" from "Supabase is
// down".
func (v *Verifier) Verify(ctx context.Context, token string) (*User, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.baseURL+"/auth/v1/user", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("apikey", v.apiKey)

	resp, err := v.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("supabase request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		// 401, 403, 422 — token is bad. Convert all to a single sentinel
		// so middleware can return one consistent HTTP status (401).
		return nil, ErrInvalidToken
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("supabase unexpected status %d", resp.StatusCode)
	}

	var u User
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return nil, fmt.Errorf("decode user: %w", err)
	}
	if u.ID == "" {
		return nil, fmt.Errorf("supabase returned empty user id")
	}
	return &u, nil
}
