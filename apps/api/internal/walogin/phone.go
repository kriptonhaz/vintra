// Package walogin powers the staff WhatsApp OTP login flow.
//
// Three jobs:
//
//   1. Detect inbound WA messages that are OTP requests (detector.go).
//   2. Resolve the sender's JID to an opt-in staff record + generate +
//      hash + persist a fresh OTP (service.go).
//   3. Verify a user-submitted code at the HTTP boundary (service.go).
//
// The send-side of the reply piggybacks on the existing wa:send asynq
// queue and its per-instance + per-JID rate limiter, so we don't add a
// separate send path.
package walogin

import (
	"strings"
	"unicode"
)

// NormalizeIDPhone canonicalizes Indonesian phone strings to the
// "62XXXXXXXXXX" E.164 form (no leading "+", digits only). Tolerates
// the common entry formats we see in tenant_members.phone — none of
// which are normalized today:
//
//	"08123456789"    → "628123456789"
//	"8123456789"     → "628123456789"
//	"628123456789"   → "628123456789"
//	"+62 812-345-67" → "62812345 67" → "6281234567"
//	"  08 1234 "     → "081234"      → "62081234" no wait — "0" prefix → "6281234"
//
// Returns "" for inputs that have no digits OR for results outside the
// 10–14 char Indonesian E.164 range. Callers should treat "" as
// "unparseable, skip".
//
// Why we do this in Go instead of SQL: PR 2 doesn't add a migration for
// a normalize_id_phone() helper. Doing it client-side keeps the schema
// untouched at the cost of an O(N) scan over a tenant's opt-in staff
// list per OTP request — fine when N is typically <10.
func NormalizeIDPhone(s string) string {
	if s == "" {
		return ""
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	digits := b.String()
	if digits == "" {
		return ""
	}
	switch {
	case strings.HasPrefix(digits, "62"):
		// already E.164 — leave alone.
	case strings.HasPrefix(digits, "0"):
		digits = "62" + digits[1:]
	case strings.HasPrefix(digits, "8"):
		// "8xxx" — bare local form sometimes typed when copy-pasting
		// from a sheet that stripped leading zero.
		digits = "62" + digits
	default:
		// Doesn't look Indonesian — return as-is so the caller's range
		// check rejects it.
	}
	// Indonesian E.164 mobile is 62 + 9–12 digits = 11–14 chars total.
	// Tolerate down to 10 (some operators still issue short numbers).
	if len(digits) < 10 || len(digits) > 14 {
		return ""
	}
	return digits
}

// PhoneFromJID extracts the E.164-normalized phone from a WhatsApp JID
// like "628123456789@s.whatsapp.net". Returns "" if the JID is empty,
// doesn't have the expected suffix, or the username isn't a parseable
// Indonesian number.
//
// Note: WhatsApp also emits LID-form JIDs ("xxxx@lid") which carry an
// opaque alias, not the phone. Those are silently rejected here — the
// inbound payload's RemoteJid is the canonical PN form when available
// (see registry.pickPhoneAndLID); we rely on that and treat a LID-only
// inbound as "not eligible for OTP login".
func PhoneFromJID(jid string) string {
	if jid == "" {
		return ""
	}
	at := strings.IndexByte(jid, '@')
	if at < 0 {
		return ""
	}
	server := jid[at+1:]
	if server != "s.whatsapp.net" {
		return ""
	}
	user := jid[:at]
	// Strip any device suffix ("628xxx:2@s.whatsapp.net" is a thing
	// when the inbound comes from a linked device). ToNonAD on the
	// caller's side usually handles this already, but be defensive.
	if colon := strings.IndexByte(user, ':'); colon >= 0 {
		user = user[:colon]
	}
	return NormalizeIDPhone(user)
}
