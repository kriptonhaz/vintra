package whatsapp

import (
	"encoding/base64"

	qrcode "github.com/skip2/go-qrcode"
)

// renderQR converts the raw whatsmeow pairing payload (a string of
// the form "2@...") into a `data:image/png;base64,...` data URL that
// the frontend can drop straight into an <img src>. Used by the QR
// event handler in provider.go.
//
// Why we don't hand the raw string to the frontend: the spec wants
// "scan this QR". Letting every client render the QR themselves means
// every client needs a QR lib (~50 KB each). Server-side render once,
// every client just shows the PNG.
//
// Medium error correction (~15%) is the WhatsApp standard. 256×256
// is enough resolution for a phone camera at normal distance.
func renderQR(code string) (string, error) {
	png, err := qrcode.Encode(code, qrcode.Medium, 256)
	if err != nil {
		return "", err
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png), nil
}
