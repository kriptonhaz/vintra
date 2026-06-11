package whatsapp

import (
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestPickPhoneAndLID(t *testing.T) {
	// Convenience builders so the test table reads cleanly.
	pn := func(user string) types.JID {
		return types.JID{User: user, Server: types.DefaultUserServer}
	}
	lid := func(user string) types.JID {
		return types.JID{User: user, Server: types.HiddenUserServer}
	}
	empty := types.JID{}

	cases := []struct {
		name    string
		a, b    types.JID
		wantPN  string
		wantLID string
	}{
		{
			name:    "real PN + @lid form",
			a:       pn("628123456789"),
			b:       lid("205101918617646"),
			wantPN:  "628123456789@s.whatsapp.net",
			wantLID: "205101918617646@lid",
		},
		{
			name:    "swapped order — same result",
			a:       lid("205101918617646"),
			b:       pn("628123456789"),
			wantPN:  "628123456789@s.whatsapp.net",
			wantLID: "205101918617646@lid",
		},
		{
			name:    "real PN only (no alt)",
			a:       pn("628123456789"),
			b:       empty,
			wantPN:  "628123456789@s.whatsapp.net",
			wantLID: "",
		},
		{
			name:    "@lid only — privacy mode, no PN known",
			a:       lid("205101918617646"),
			b:       empty,
			wantPN:  "",
			wantLID: "205101918617646@lid",
		},
		{
			name:    "LID-style PN JID (15 digits on @s.whatsapp.net) classed as LID",
			a:       pn("205101918617646"),
			b:       empty,
			wantPN:  "",
			wantLID: "205101918617646@s.whatsapp.net",
		},
		{
			name:    "LID-style PN JID paired with real PN — real wins",
			a:       pn("205101918617646"),
			b:       pn("628123456789"),
			wantPN:  "628123456789@s.whatsapp.net",
			wantLID: "205101918617646@s.whatsapp.net",
		},
		{
			name:    "PN with country-code-only 8 digits — still real",
			a:       pn("12345678"),
			b:       empty,
			wantPN:  "12345678@s.whatsapp.net",
			wantLID: "",
		},
		{
			name:    "PN with 7 digits — too short, treated as LID",
			a:       pn("1234567"),
			b:       empty,
			wantPN:  "",
			wantLID: "1234567@s.whatsapp.net",
		},
		{
			name:    "PN with non-digit username — not classified",
			a:       types.JID{User: "abc123", Server: types.DefaultUserServer},
			b:       empty,
			wantPN:  "",
			wantLID: "abc123@s.whatsapp.net",
		},
		{
			name:    "both empty",
			a:       empty,
			b:       empty,
			wantPN:  "",
			wantLID: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotPN, gotLID := pickPhoneAndLID(tc.a, tc.b)
			if gotPN != tc.wantPN {
				t.Errorf("PN: got %q, want %q", gotPN, tc.wantPN)
			}
			if gotLID != tc.wantLID {
				t.Errorf("LID: got %q, want %q", gotLID, tc.wantLID)
			}
		})
	}
}
