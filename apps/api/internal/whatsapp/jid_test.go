package whatsapp

import "testing"

func TestNormalizeJID(t *testing.T) {
	cases := []struct {
		in      string
		want    string
		wantErr bool
	}{
		// Already-formatted JIDs pass through.
		{"628123456789@s.whatsapp.net", "628123456789@s.whatsapp.net", false},
		{"628@g.us", "628@g.us", false}, // we don't validate, just normalize

		// International formats.
		{"+628123456789", "628123456789@s.whatsapp.net", false},
		{"628123456789", "628123456789@s.whatsapp.net", false},

		// Indonesian local with leading 0 → 62 conversion. After
		// stripping separators, "0812..." → "62812...".
		{"08123456789", "628123456789@s.whatsapp.net", false},        // 11 digits → 12
		{"0812-3456-7890", "6281234567890@s.whatsapp.net", false},    // 12 → 13
		{"+62 812-3456-7890", "6281234567890@s.whatsapp.net", false}, // already 62-prefixed

		// Separators stripped.
		{"+62 812 3456 7890", "6281234567890@s.whatsapp.net", false},
		{"(0812) 345-6789", "628123456789@s.whatsapp.net", false}, // 11 digits → 12

		// Errors.
		{"", "", true},
		{"abc", "", true},
		{"123", "", true},                // too short
		{"+62812abc6789", "", true},      // letters after stripping
		{"123456789012345678901", "", true}, // too long (21 digits)
	}

	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, err := NormalizeJID(tc.in)
			if tc.wantErr {
				if err == nil {
					t.Errorf("input %q: expected error, got %q", tc.in, got)
				}
				return
			}
			if err != nil {
				t.Errorf("input %q: unexpected error %v", tc.in, err)
				return
			}
			if got != tc.want {
				t.Errorf("input %q: got %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}
