package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// mockSupabase returns an httptest server that mimics
// /auth/v1/user — it inspects the Bearer token and apikey and
// responds accordingly. Test cases configure the response via the
// supplied handler closure.
func mockSupabase(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return srv
}

func TestVerify_ValidToken(t *testing.T) {
	srv := mockSupabase(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/auth/v1/user" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer good-token" {
			t.Errorf("Authorization = %q, want Bearer good-token", got)
		}
		if got := r.Header.Get("apikey"); got != "secret-xyz" {
			t.Errorf("apikey = %q, want secret-xyz", got)
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"id":"abc-123","email":"a@b.co"}`)
	})

	v := New(srv.URL, "secret-xyz")
	u, err := v.Verify(context.Background(), "good-token")
	if err != nil {
		t.Fatalf("Verify: unexpected error: %v", err)
	}
	if u.ID != "abc-123" {
		t.Errorf("ID = %q, want abc-123", u.ID)
	}
	if u.Email != "a@b.co" {
		t.Errorf("Email = %q, want a@b.co", u.Email)
	}
}

func TestVerify_RejectsBadToken(t *testing.T) {
	srv := mockSupabase(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"error":"invalid token"}`)
	})

	v := New(srv.URL, "secret-xyz")
	_, err := v.Verify(context.Background(), "bogus")
	if !errors.Is(err, ErrInvalidToken) {
		t.Errorf("error = %v, want ErrInvalidToken", err)
	}
}

func TestVerify_RejectsAll4xxAsInvalidToken(t *testing.T) {
	for _, code := range []int{401, 403, 422} {
		t.Run(fmt.Sprintf("status_%d", code), func(t *testing.T) {
			srv := mockSupabase(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(code)
				fmt.Fprint(w, `{"error":"nope"}`)
			})

			v := New(srv.URL, "x")
			_, err := v.Verify(context.Background(), "x")
			if !errors.Is(err, ErrInvalidToken) {
				t.Errorf("status %d → error %v, want ErrInvalidToken", code, err)
			}
		})
	}
}

func TestVerify_5xxNotInvalidToken(t *testing.T) {
	// Supabase being down should NOT be treated as "token is bad" —
	// callers (middleware) should return 503 or pass through, not 401.
	srv := mockSupabase(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	v := New(srv.URL, "x")
	_, err := v.Verify(context.Background(), "x")
	if errors.Is(err, ErrInvalidToken) {
		t.Errorf("5xx classified as ErrInvalidToken — should be a wrapped error")
	}
	if err == nil {
		t.Error("expected an error on 5xx")
	}
}

func TestVerify_TrimsTrailingSlash(t *testing.T) {
	srv := mockSupabase(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/auth/v1/user") {
			t.Errorf("expected suffix /auth/v1/user, got %s", r.URL.Path)
		}
		fmt.Fprint(w, `{"id":"u1","email":"x@y.z"}`)
	})

	// Construct with a trailing slash on the base URL — verifier should
	// normalize so we don't end up calling //auth/v1/user.
	v := New(srv.URL+"/", "secret")
	_, err := v.Verify(context.Background(), "t")
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}
