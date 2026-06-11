package walogin

import "testing"

func TestIsOtpRequest(t *testing.T) {
	tests := []struct {
		name string
		body string
		want bool
	}{
		// Prefilled wa.me text — exact and lowercased.
		{"prefilled", "Minta OTP Login Vintra", true},
		{"prefilled lowercase", "minta otp login vintra", true},

		// Common variants staff might type.
		{"bare otp", "otp", true},
		{"bare login", "login", true},
		{"masuk request", "masuk dong", true},
		{"kode login", "kode login", true},
		{"kode  login spaces", "kode  login", true},
		{"mixed case", "OtP LoGiN", true},
		{"with greeting", "halo, login", true},

		// Negatives: customer messages that shouldn't trigger.
		{"empty", "", false},
		{"too short", "ok", false},
		{"too long", "saya mau pesan kopi tapi kemarin tidak bisa login ke aplikasi tolong dibantu", false},
		{"no keyword", "halo gan", false},
		{"login embedded — loginnya", "loginnya gimana?", false},
		{"otp embedded — otpsdor", "otpsdor", false},
		{"login substring in domain", "myloginhost", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := IsOtpRequest(tc.body)
			if got != tc.want {
				t.Errorf("IsOtpRequest(%q) = %v, want %v", tc.body, got, tc.want)
			}
		})
	}
}
