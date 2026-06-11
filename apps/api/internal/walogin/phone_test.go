package walogin

import "testing"

func TestNormalizeIDPhone(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		// Canonical E.164 — pass through.
		{"628123456789", "628123456789"},
		// Leading-zero local form.
		{"08123456789", "628123456789"},
		// Bare local (no leading zero, used in some import sheets).
		{"8123456789", "628123456789"},
		// With "+" prefix and spaces.
		{"+62 812-3456-789", "628123456789"},
		// With parentheses, dashes, dots.
		{"(0812) 345-6789", "628123456789"},
		// Leading-zero with surrounding whitespace.
		{"  08123456789  ", "628123456789"},

		// Edge: very short — out of Indonesian E.164 range.
		{"628", ""},
		// Edge: very long.
		{"6281234567890123456", ""},
		// Empty.
		{"", ""},
		// Non-digits only.
		{"abcdef", ""},
		// Non-Indonesian (kept as-is, but only if in 10–14 char range).
		{"+1 555 123 4567", "15551234567"},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got := NormalizeIDPhone(tc.in)
			if got != tc.want {
				t.Errorf("NormalizeIDPhone(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestPhoneFromJID(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		// Canonical PN JID — extract + normalize (already canonical).
		{"628123456789@s.whatsapp.net", "628123456789"},
		// With device suffix (whatsmeow gives us these from linked devices).
		{"628123456789:2@s.whatsapp.net", "628123456789"},
		// LID-form — rejected (not a phone).
		{"123456789012345@lid", ""},
		// Missing server.
		{"628123456789", ""},
		// Empty.
		{"", ""},
		// Non-Indonesian-looking but parseable.
		{"15551234567@s.whatsapp.net", "15551234567"},
	}
	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			got := PhoneFromJID(tc.in)
			if got != tc.want {
				t.Errorf("PhoneFromJID(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
