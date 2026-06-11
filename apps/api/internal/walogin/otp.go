package walogin

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"golang.org/x/crypto/argon2"
)

// OtpDigits is the length of generated codes. 6 digits = 10^6 keyspace.
// Combined with 5-min TTL + 3-attempt cap (verify endpoint) this puts
// brute force well outside any reasonable attack budget.
const OtpDigits = 6

// argon2 parameters. These are deliberately modest — the hashed value
// is a 6-digit code, not a password, and the row is consumed after at
// most 3 attempts. We pay ~5–10ms per hash; making it slower buys no
// real security but does add latency to the inbound handler hot path.
const (
	argonTime    uint32 = 1
	argonMemory  uint32 = 19 * 1024 // 19 MiB
	argonThreads uint8  = 1
	argonKeyLen  uint32 = 32
	argonSaltLen        = 16
)

// ErrInvalidHashFormat is returned by VerifyOtp when the stored hash
// isn't in our expected "$argon2id$..." encoding. Should never happen
// in practice — would indicate DB corruption.
var ErrInvalidHashFormat = errors.New("walogin: invalid otp hash format")

// GenerateOtp draws a fresh OTP from crypto/rand. Returns the
// zero-padded 6-digit string; the caller is responsible for
// immediately hashing it via HashOtp and sending the cleartext via
// WhatsApp.
//
// Never log the return value. Never store it anywhere except the
// outbound wa:send body (which is itself the user-facing delivery).
func GenerateOtp() (string, error) {
	max := big.NewInt(1_000_000) // 10^OtpDigits — keep in sync if OtpDigits changes
	n, err := rand.Int(rand.Reader, max)
	if err != nil {
		return "", fmt.Errorf("walogin: read otp randomness: %w", err)
	}
	// Zero-pad to OtpDigits so e.g. 42 renders as "000042". Critical
	// for verification: the user types what they see, and we want a
	// constant-length keyspace.
	return fmt.Sprintf("%0*d", OtpDigits, n.Int64()), nil
}

// HashOtp argon2id-hashes the plaintext code with a fresh per-row salt.
// Output format mirrors the PHC string convention so VerifyOtp doesn't
// need to receive the parameters separately:
//
//	$argon2id$v=19$m=19456,t=1,p=1$<base64-salt>$<base64-hash>
//
// Salt + hash use raw-base64 (no padding) to match upstream argon2-cli
// output, in case anything downstream wants to interop with it.
func HashOtp(code string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("walogin: read salt: %w", err)
	}
	key := argon2.IDKey([]byte(code), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyOtp returns nil iff `code` hashes to the stored value. Uses
// crypto/subtle.ConstantTimeCompare to keep the comparison side-channel-
// free; verify-endpoint callers should additionally not branch on the
// error type before responding (return the same error message for
// hash-format-bad, hash-mismatch, etc).
func VerifyOtp(code, encoded string) error {
	// Expected: "$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>"
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return ErrInvalidHashFormat
	}

	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return ErrInvalidHashFormat
	}

	var memory, time uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads); err != nil {
		return ErrInvalidHashFormat
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return ErrInvalidHashFormat
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return ErrInvalidHashFormat
	}

	got := argon2.IDKey([]byte(code), salt, time, memory, threads, uint32(len(want)))
	if subtle.ConstantTimeCompare(want, got) != 1 {
		return errors.New("walogin: otp mismatch")
	}
	return nil
}
