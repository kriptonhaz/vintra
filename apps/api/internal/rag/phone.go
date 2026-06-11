package rag

import "strings"

// NormalizePhone strips WhatsApp JID suffix, +, spaces, and dashes,
// returning a plain digit string (e.g. "628118492869").
// customers.phone is already stored in "62..." form, so this lets us
// match wa_contacts.remote_jid against customers.phone directly.
func NormalizePhone(s string) string {
	// Strip @s.whatsapp.net or @lid suffix
	if idx := strings.Index(s, "@"); idx >= 0 {
		s = s[:idx]
	}
	// Strip non-digit characters
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
