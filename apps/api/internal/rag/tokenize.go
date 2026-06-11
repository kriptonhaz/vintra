package rag

import (
	"strings"
	"unicode"
)

// stopwords are words that are noisy in SQL ILIKE product-name queries.
// NOTE: "harga", "stok", "jam", "bayar" are intentionally NOT here —
// they are valid product-name fragments and also used as trigger keywords.
// Tokenize is only for building DB search terms, not for trigger matching.
var stopwords = map[string]bool{
	"ada": true, "dan": true, "yang": true, "untuk": true, "dengan": true,
	"ini": true, "itu": true, "dari": true, "ke": true, "di": true,
	"nya": true, "apa": true, "bisa": true, "mau": true, "minta": true,
	"tolong": true, "mohon": true, "dong": true, "kak": true,
	"mas": true, "mbak": true, "pak": true, "bu": true, "min": true,
	"tersedia": true, "ready": true,
}

// Tokenize lowercases s, strips punctuation, drops stopwords, and returns
// tokens of at least 3 characters. Used by retrievers to build ILIKE terms.
// NOT used for trigger keyword matching — see MatchesKeywords.
func Tokenize(s string) []string {
	s = strings.ToLower(s)
	var tokens []string
	var cur strings.Builder
	flush := func() {
		t := cur.String()
		cur.Reset()
		if len(t) >= 3 && !stopwords[t] {
			tokens = append(tokens, t)
		}
	}
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			cur.WriteRune(r)
		} else {
			flush()
		}
	}
	flush()
	return tokens
}

// MatchesKeywords checks whether body contains any of the keywords as a
// raw case-insensitive substring. Intentionally does NOT tokenize — trigger
// keywords like "harga", "stok", "jam" must match even if Tokenize would
// strip them for other purposes.
func MatchesKeywords(body string, keywords []string) bool {
	b := strings.ToLower(body)
	for _, k := range keywords {
		if strings.Contains(b, strings.ToLower(k)) {
			return true
		}
	}
	return false
}

// catalogIndicators signal the customer is asking for a general listing
// rather than a specific product ("ada menu apa aja", "katalog lengkap",
// "ada daftar harga?"). When one of these appears in the tokens list,
// product-search retrievers should switch to "list everything" mode
// instead of returning nothing because the user didn't name a product.
var catalogIndicators = map[string]bool{
	"menu":    true,
	"daftar":  true,
	"katalog": true,
	"list":    true,
	"semua":   true,
	"lengkap": true,
}

// IsCatalogQuery returns true when any token suggests the customer is
// asking for a general listing rather than a specific item.
func IsCatalogQuery(tokens []string) bool {
	for _, t := range tokens {
		if catalogIndicators[t] {
			return true
		}
	}
	return false
}
