// pgtype.UUID is the on-the-wire shape pgx v5 uses for uuid columns.
// It's a [16]byte + Valid flag struct — not a string. Tiny helpers
// here convert to/from the canonical 8-4-4-4-12 hyphenated string
// form for HTTP boundaries.
package db

import (
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ParseUUID converts the canonical hyphenated string form into a
// pgtype.UUID. Returns Valid=false if the input is empty (lets us
// treat optional UUIDs uniformly), error on a malformed non-empty
// input.
func ParseUUID(s string) (pgtype.UUID, error) {
	if s == "" {
		return pgtype.UUID{Valid: false}, nil
	}
	u, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: u, Valid: true}, nil
}

// UUIDString returns the canonical hyphenated form of a pgtype.UUID,
// or "" when the value is null/invalid.
func UUIDString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return uuid.UUID(u.Bytes).String()
}
