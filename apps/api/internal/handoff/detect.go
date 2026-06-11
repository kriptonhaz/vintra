// Package handoff implements the AI→human handoff workflow (JUR-74).
//
// Two halves:
//   - Detect: parse an AI reply for handoff intent. v1 uses heuristic
//     substring matching against a small Indonesian phrase list. v2
//     will switch to structured JSON output from the LLM (see TODO).
//   - Notifier: enqueue the admin alert via the three configured
//     channels (in-app notification, web push, admin WhatsApp message).
//
// Why heuristic v1: the system prompt for AI auto-reply already enforces
// a consistent fallback phrase ("Maaf kak, aku alihkan ke admin..."),
// so substring matching gets us 90%+ accuracy with zero LLM cost
// overhead. Structured output adds ~30 tokens per reply and depends on
// DeepSeek's JSON-mode reliability — defer until production data shows
// heuristic misses.
package handoff

import (
	"regexp"
	"strings"
)

// Result is what Detect returns. NeedsHuman=true means the worker
// should flip wa_contacts.needs_human, store the reason+summary, and
// dispatch admin notifications. NeedsHuman=false → AI reply proceeds
// normally; reason/summary are ignored.
type Result struct {
	NeedsHuman bool
	Reason     string // 3-6 words for admin context
	Summary    string // 1-2 sentence explanation
}

// handoffPatterns are regexes that, when matched against the AI's reply,
// signal an intent to escalate to a human admin. The earlier substring
// list missed perfectly valid phrasings like "alihkan chat ini ke admin"
// because it required the verb and the object to be adjacent — these
// regexes allow up to ~40 chars of filler between the trigger verb and
// the "admin" mention. Matched case-insensitively (we lowercase the
// reply before matching).
//
// Adding a pattern here ALSO requires the system prompt updates so the
// LLM uses it consistently — patterns are reactive insurance, not the
// primary signal.
var handoffPatterns = []*regexp.Regexp{
	// "alihkan [chat ini] [ke] admin", "alihkan [ke] tim"
	regexp.MustCompile(`\balihkan\b[^.!?\n]{0,40}?\b(ke\s+)?(admin|tim)\b`),
	// "hubungkan/hubungi/hubungin [dengan] [ke] admin"
	regexp.MustCompile(`\bhubung(kan|i|in)\b[^.!?\n]{0,40}?\b(ke\s+|dengan\s+)?admin\b`),
	// "tanya/tanyakan [ke] admin"
	regexp.MustCompile(`\btanya(kan)?\b[^.!?\n]{0,40}?\b(ke\s+)?admin\b`),
	// "diteruskan/teruskan [ke] admin"
	regexp.MustCompile(`\b(di)?teruskan\b[^.!?\n]{0,40}?\b(ke\s+)?admin\b`),
	// "forward [to/ke] admin"
	regexp.MustCompile(`\bforward\b[^.!?\n]{0,40}?\b(to\s+|ke\s+)?admin\b`),
	// "bantu(in) admin", "ditangani admin", "admin yang bantu/akan"
	regexp.MustCompile(`\badmin\s+(yang\s+)?(akan|bantu|info|bakal|nanti)\b`),
	regexp.MustCompile(`\bnanti\s+admin\b`),
}

// Detect runs the heuristic match on `reply`. When a handoff phrase
// matches:
//   - Reason is a short label derived from the customer's last message
//     (passed as `lastIncoming`) — first ~6 words. Falls back to
//     "perlu bantuan admin" if empty.
//   - Summary is the AI's own reply (truncated to ~200 chars). The
//     idea: the AI just told the customer what it was going to escalate,
//     so its own text is a fine human-readable summary.
//
// TODO(JUR-74-v2): replace this with structured JSON parse from the
// LLM (`{reply, needs_human, reason, summary}`). Heuristic v1 is good
// enough to ship — switch when accuracy issues surface in production.
func Detect(reply, lastIncoming string) Result {
	lowReply := strings.ToLower(reply)
	matched := false
	for _, re := range handoffPatterns {
		if re.MatchString(lowReply) {
			matched = true
			break
		}
	}
	if !matched {
		return Result{NeedsHuman: false}
	}
	return Result{
		NeedsHuman: true,
		Reason:     summarizeIncoming(lastIncoming),
		Summary:    summarizeReply(reply),
	}
}

// summarizeIncoming truncates the customer message to a short label.
// "berapa harga teh?" → "berapa harga teh?" (under threshold, kept whole).
// "saya ingin bertanya tentang menu malam minggu ini bisa apa saja..." →
// truncated to first ~6 words.
func summarizeIncoming(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "perlu bantuan admin"
	}
	words := strings.Fields(s)
	if len(words) > 6 {
		words = words[:6]
	}
	out := strings.Join(words, " ")
	if len(out) > 60 {
		out = out[:60] + "…"
	}
	return out
}

// summarizeReply trims the AI's reply to ~200 chars. The full reply
// is what the customer will see; the admin notification echoes the
// shortened version for context.
func summarizeReply(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= 200 {
		return s
	}
	return s[:200] + "…"
}
