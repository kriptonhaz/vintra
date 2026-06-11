package ai

import "testing"

func TestPriceFor(t *testing.T) {
	cases := []struct {
		model string
		in    int
		out   int
		want  string
	}{
		// gpt-4o-mini: $0.15/1M in, $0.60/1M out
		// 1000 in * 0.15/1M = 0.00015, 500 out * 0.60/1M = 0.00030 → 0.000450
		{"gpt-4o-mini", 1000, 500, "0.000450"},
		// gpt-4o: $2.50/1M in, $10.00/1M out
		// 2000 in * 2.50/1M = 0.005000, 1000 out * 10.00/1M = 0.010000 → 0.015000
		{"gpt-4o", 2000, 1000, "0.015000"},
		// gemini-1.5-flash: $0.075/1M in, $0.30/1M out
		// 1000 in * 0.075/1M = 0.000075, 500 out * 0.30/1M = 0.000150 → 0.000225
		{"gemini-1.5-flash", 1000, 500, "0.000225"},
		// unknown model → zero
		{"unknown-model-xyz", 999, 999, "0.000000"},
		// zero tokens → zero
		{"gpt-4o-mini", 0, 0, "0.000000"},
	}

	for _, tc := range cases {
		got := PriceFor(tc.model, tc.in, tc.out)
		if got != tc.want {
			t.Errorf("PriceFor(%q, %d, %d) = %q, want %q", tc.model, tc.in, tc.out, got, tc.want)
		}
	}
}
