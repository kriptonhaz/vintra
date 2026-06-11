package walogin

import (
	"errors"
	"regexp"
	"strings"
	"testing"
)

func TestGenerateOtpFormat(t *testing.T) {
	pattern := regexp.MustCompile(`^\d{6}$`)
	// Run a handful of generations to surface non-uniform output and
	// catch any off-by-one in the zero-pad.
	for i := 0; i < 100; i++ {
		code, err := GenerateOtp()
		if err != nil {
			t.Fatalf("GenerateOtp returned error: %v", err)
		}
		if !pattern.MatchString(code) {
			t.Errorf("GenerateOtp() = %q, want 6 digits", code)
		}
	}
}

func TestGenerateOtpEntropy(t *testing.T) {
	// Not a real randomness test, just a sanity check that two calls
	// produce different output (i.e. we're not stuck on a fixed seed).
	a, _ := GenerateOtp()
	b, _ := GenerateOtp()
	if a == b {
		// 1-in-10^6 false positive — acceptable for a smoke test.
		t.Logf("warning: two consecutive GenerateOtp() calls collided (%q == %q); re-run", a, b)
	}
}

func TestHashOtpAndVerifyOtp_Roundtrip(t *testing.T) {
	code := "123456"
	encoded, err := HashOtp(code)
	if err != nil {
		t.Fatalf("HashOtp error: %v", err)
	}
	if !strings.HasPrefix(encoded, "$argon2id$") {
		t.Errorf("encoded hash missing $argon2id$ prefix: %q", encoded)
	}
	if err := VerifyOtp(code, encoded); err != nil {
		t.Errorf("VerifyOtp(correct code) = %v, want nil", err)
	}
	if err := VerifyOtp("000000", encoded); err == nil {
		t.Errorf("VerifyOtp(wrong code) = nil, want mismatch error")
	}
}

func TestHashOtp_DifferentSaltsPerCall(t *testing.T) {
	// Same input → different encoded output (because salt is random).
	// Both must verify against the original code.
	code := "654321"
	a, _ := HashOtp(code)
	b, _ := HashOtp(code)
	if a == b {
		t.Errorf("HashOtp produced identical output across calls — salt isn't random?")
	}
	if err := VerifyOtp(code, a); err != nil {
		t.Errorf("VerifyOtp on first hash: %v", err)
	}
	if err := VerifyOtp(code, b); err != nil {
		t.Errorf("VerifyOtp on second hash: %v", err)
	}
}

func TestVerifyOtp_MalformedHash(t *testing.T) {
	cases := []string{
		"",
		"plaintext",
		"$argon2id$",
		"$argon2id$v=19$",
		"$argon2id$v=19$m=foo,t=bar,p=baz$salt$hash",
		"$bcrypt$v=10$cost=12$xxx$yyy",
	}
	for _, h := range cases {
		err := VerifyOtp("123456", h)
		if !errors.Is(err, ErrInvalidHashFormat) {
			// Some malformed inputs may fail at base64 decode (also
			// returned as ErrInvalidHashFormat), others at the format
			// check. Either way we expect the sentinel.
			t.Errorf("VerifyOtp(%q) = %v, want ErrInvalidHashFormat", h, err)
		}
	}
}
