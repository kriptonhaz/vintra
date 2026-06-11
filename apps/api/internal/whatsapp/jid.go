package whatsapp

import (
	"fmt"
	"strings"
)

// NormalizeJID converts a user-typed phone number into a WhatsApp JID.
// Accepts the common Indonesian inputs:
//   "+628123456789"       → "628123456789@s.whatsapp.net"
//   "628123456789"        → "628123456789@s.whatsapp.net"
//   "08123456789"         → "628123456789@s.whatsapp.net"  (leading 0 → 62)
//   "0812-3456-7890"      → "628123456789@s.whatsapp.net"  (separators stripped)
//   "628...@s.whatsapp.net" → returned as-is (already JID-shaped)
//
// Returns an error for inputs that don't look like a phone number
// (too short, contains letters, etc.).
func NormalizeJID(input string) (string, error) {
	s := strings.TrimSpace(input)
	if s == "" {
		return "", fmt.Errorf("empty phone number")
	}

	// Already a JID — pass through unchanged.
	if strings.Contains(s, "@") {
		return s, nil
	}

	// Strip common separators: spaces, dashes, dots, parens.
	cleaned := strings.Map(func(r rune) rune {
		switch r {
		case ' ', '-', '.', '(', ')':
			return -1
		}
		return r
	}, s)

	// Strip leading +.
	if strings.HasPrefix(cleaned, "+") {
		cleaned = cleaned[1:]
	}

	// Convert Indonesian local format (leading 0) to international
	// (62 prefix). Only fires when we're confident it's an Indonesian
	// local — "08..." with at least 9 more digits.
	if strings.HasPrefix(cleaned, "08") && len(cleaned) >= 10 {
		cleaned = "62" + cleaned[1:]
	}

	// Must be all digits at this point.
	for _, r := range cleaned {
		if r < '0' || r > '9' {
			return "", fmt.Errorf("invalid character %q in phone number", r)
		}
	}

	// Min/max sanity. Indonesian mobile: 11-13 digits with 62 prefix.
	// Other countries can be 7-15. WhatsApp accepts anything in that
	// range — we just need a reasonable floor/ceiling.
	if len(cleaned) < 8 || len(cleaned) > 20 {
		return "", fmt.Errorf("phone number length %d out of range", len(cleaned))
	}

	return cleaned + "@s.whatsapp.net", nil
}
