package handoff

import "testing"

func TestDetect_PositiveCases(t *testing.T) {
	cases := []struct{ name, reply string }{
		{"explicit alihkan", "Maaf kak, aku alihkan ke admin ya 🙏"},
		{"hubungkan", "Mau aku hubungkan ke admin biar lebih jelas?"},
		{"tanya admin", "Untuk detailnya, tanya admin langsung ya kak"},
		{"case insensitive", "Saya ALIHKAN KE ADMIN ya"},
		// Production miss — "alihkan chat ini ke admin" wasn't matched by
		// the original substring detector. Regex now allows filler.
		{"alihkan with filler", "Baik kak, aku alihkan chat ini ke admin ya untuk bantu proses pemesanannya"},
		{"nanti admin", "Nanti admin yang akan infoin detail selanjutnya"},
		{"admin yang bantu", "admin yang bakal bantu proses pesananmu lebih lanjut ya"},
		{"hubungin", "aku hubungin admin dulu ya kak"},
		{"diteruskan", "Pesan kakak akan diteruskan ke admin kami"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := Detect(c.reply, "berapa harganya")
			if !r.NeedsHuman {
				t.Errorf("expected NeedsHuman=true for %q", c.reply)
			}
		})
	}
}

func TestDetect_NegativeCases(t *testing.T) {
	cases := []struct{ name, reply string }{
		{"normal greeting", "Halo kak, ada yang bisa aku bantu? 😊"},
		{"price answer", "Teh Original Rp 4.000 ya kak, mau pesan?"},
		{"close mention", "Admin lagi sibuk, sebentar ya"}, // word "admin" alone shouldn't trigger
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := Detect(c.reply, "halo")
			if r.NeedsHuman {
				t.Errorf("expected NeedsHuman=false for %q", c.reply)
			}
		})
	}
}

func TestDetect_ReasonAndSummary(t *testing.T) {
	r := Detect(
		"Maaf kak, untuk pesanan teh ini aku alihkan ke admin ya 🙏",
		"saya mau pesan teh original buat besok pagi",
	)
	if !r.NeedsHuman {
		t.Fatal("expected NeedsHuman=true")
	}
	if r.Reason == "" {
		t.Error("expected non-empty Reason")
	}
	if r.Summary == "" {
		t.Error("expected non-empty Summary")
	}
}

func TestDetect_EmptyIncomingFallback(t *testing.T) {
	r := Detect("Aku alihkan ke admin ya", "")
	if r.Reason != "perlu bantuan admin" {
		t.Errorf("expected fallback reason, got %q", r.Reason)
	}
}

func TestSummarizeIncoming_LongMessageTruncated(t *testing.T) {
	long := "saya ingin bertanya tentang menu untuk acara ulang tahun adik saya minggu depan apakah bisa pesan paket lengkap"
	got := summarizeIncoming(long)
	if len(got) > 65 { // 60 + "…"
		t.Errorf("expected truncated, got %d chars: %q", len(got), got)
	}
}
