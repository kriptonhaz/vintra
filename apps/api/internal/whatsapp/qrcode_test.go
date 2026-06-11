package whatsapp

import (
	"strings"
	"testing"
)

func TestRenderQR_DataURL(t *testing.T) {
	dataURL, err := renderQR("2@AbCdEf/dummy-pairing-payload")
	if err != nil {
		t.Fatalf("renderQR: %v", err)
	}
	if !strings.HasPrefix(dataURL, "data:image/png;base64,") {
		t.Errorf("output doesn't start with the expected data URL prefix: %q", dataURL[:40])
	}
	// PNG header magic in base64: "iVBOR" is the first 5 chars of any
	// base64-encoded PNG file (\x89PNG\r\n → "iVBORw0KGgo..." in b64).
	body := strings.TrimPrefix(dataURL, "data:image/png;base64,")
	if !strings.HasPrefix(body, "iVBOR") {
		t.Errorf("body doesn't look like base64-encoded PNG: %q...", body[:20])
	}
	if len(body) < 200 {
		t.Errorf("body too short (%d bytes) — QR encoding likely failed silently", len(body))
	}
}

func TestRenderQR_EmptyInputErrors(t *testing.T) {
	_, err := renderQR("")
	if err == nil {
		t.Error("renderQR(\"\") returned no error — qrcode lib should reject empty input")
	}
}
