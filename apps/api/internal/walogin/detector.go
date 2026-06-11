package walogin

import "regexp"

// otpTrigger matches the keywords we accept as an "I want to log in"
// signal. Case-insensitive, word-bounded so "loginnya" (embedded inside
// a larger word) doesn't match. Kept short to limit false positives —
// the staff-lookup downstream is the real gatekeeper, but we still
// avoid wasting a Postgres round-trip on obvious customer-chatter.
//
// Languages covered:
//
//	otp        — universal acronym
//	login      — universal English borrow word
//	masuk      — Indonesian "enter / sign in"
//	kode login — Indonesian "login code", common phrasing
//
// Why we accept either keyword alone (not requiring "minta" prefix):
// staff may retype the wa.me-prefilled text from memory and drop the
// "minta" verb. The opt-in tenant_members.wa_login_enabled flag is the
// authorization gate; the regex is just routing.
var otpTrigger = regexp.MustCompile(`(?i)\b(otp|login|masuk|kode\s*login)\b`)

// maxOtpRequestLen caps the message length we even bother scanning.
// Legitimate OTP requests are short ("Minta OTP Login Vintra" is
// 25 chars; the wa.me prefill is what most users send). Anything past
// 60 chars is almost certainly a real customer message that happens
// to contain "login" or "otp" as a substring.
const maxOtpRequestLen = 60

// minOtpRequestLen filters out empty / 1-char garbage. The shortest
// real trigger is "otp" (3 chars).
const minOtpRequestLen = 3

// IsOtpRequest returns true when the message body looks like a login
// OTP request. False positives are mitigated downstream by the
// opt-in tenant_member lookup — only registered staff who flipped
// wa_login_enabled actually trigger an OTP send.
func IsOtpRequest(body string) bool {
	n := len(body)
	if n < minOtpRequestLen || n > maxOtpRequestLen {
		return false
	}
	return otpTrigger.MatchString(body)
}
