package rag

import (
	"testing"

	"github.com/kriptonhaz/vintra/apps/api/internal/tier"
)

func TestTokenize(t *testing.T) {
	tokens := Tokenize("Berapa harga kopi susu?")
	// "harga" is NOT a stopword — it's a valid product-name fragment
	found := map[string]bool{}
	for _, tok := range tokens {
		found[tok] = true
	}
	if !found["kopi"] {
		t.Error("expected 'kopi' in tokens")
	}
	if !found["susu"] {
		t.Error("expected 'susu' in tokens")
	}
	// Short tokens dropped
	for _, tok := range tokens {
		if len(tok) < 3 {
			t.Errorf("token %q is shorter than 3 chars", tok)
		}
	}
}

func TestMatchesKeywords_DoesNotTokenize(t *testing.T) {
	// "harga" would be stripped by Tokenize but must still trigger MatchesKeywords.
	if !MatchesKeywords("berapa harga kopi?", []string{"harga"}) {
		t.Error("MatchesKeywords should match 'harga' via raw substring, not tokenized")
	}
	if !MatchesKeywords("ada stok?", []string{"stok"}) {
		t.Error("MatchesKeywords should match 'stok'")
	}
	if !MatchesKeywords("jam buka berapa?", []string{"jam"}) {
		t.Error("MatchesKeywords should match 'jam'")
	}
	if MatchesKeywords("terima kasih", []string{"harga", "stok"}) {
		t.Error("MatchesKeywords should not match unrelated message")
	}
}

func TestMatchesKeywords_CaseInsensitive(t *testing.T) {
	if !MatchesKeywords("HARGA Kopi", []string{"harga"}) {
		t.Error("MatchesKeywords should be case-insensitive")
	}
}

// IsCatalogQuery flips product-search retrievers into "list everything"
// mode when the customer asks a general question like "ada menu apa aja?"
// — without this, a body that's all stopwords + generic words yields no
// product-name tokens and the retriever silently returns nothing.
func TestIsCatalogQuery(t *testing.T) {
	cases := []struct {
		name    string
		tokens  []string
		catalog bool
	}{
		{"explicit menu", Tokenize("ada menu apa aja ya"), true},
		{"daftar harga", Tokenize("daftar harga"), true},
		{"katalog lengkap", Tokenize("katalog lengkap dong"), true},
		{"specific product", Tokenize("ada teh manis"), false},
		{"specific price", Tokenize("berapa harga kopi"), false},
		{"empty body", Tokenize("ok"), false},
	}
	for _, c := range cases {
		got := IsCatalogQuery(c.tokens)
		if got != c.catalog {
			t.Errorf("%s: tokens=%v → IsCatalogQuery=%v, want %v", c.name, c.tokens, got, c.catalog)
		}
	}
}

func TestNormalizePhone(t *testing.T) {
	cases := []struct{ in, want string }{
		{"628118492869@s.whatsapp.net", "628118492869"},
		{"+62 811-849-2869", "628118492869"},
		{"62 811 849 2869", "628118492869"},
		{"628118492869", "628118492869"},
	}
	for _, c := range cases {
		got := NormalizePhone(c.in)
		if got != c.want {
			t.Errorf("NormalizePhone(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestTierAtLeast(t *testing.T) {
	if tier.AtLeast("", "basic") {
		t.Error("free tier should not meet basic requirement")
	}
	if tier.AtLeast("basic", "komplit") {
		t.Error("basic should not meet komplit requirement")
	}
	if !tier.AtLeast("komplit", "basic") {
		t.Error("komplit should meet basic requirement")
	}
	if !tier.AtLeast("komplit", "komplit") {
		t.Error("komplit should meet komplit requirement")
	}
	if !tier.AtLeast("enterprise", "komplit") {
		t.Error("enterprise should meet komplit requirement")
	}
}
