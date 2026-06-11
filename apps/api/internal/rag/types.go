// Package rag implements retrieval-augmented generation for WhatsApp AI replies.
package rag

import (
	"context"

	"github.com/jackc/pgx/v5/pgtype"

	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
)

// Snippet is one piece of retrieved context injected into the AI prompt.
type Snippet struct {
	Text      string
	Source    string // retrieval_type of the tool that produced it
	ToolID    string
	LatencyMs int64
	// RawRows is populated only when verbose=true (admin preview).
	RawRows []map[string]any
	// Attachments are S3-backed images the AI reply layer can match
	// against the generated text and send as a follow-up media message.
	// Currently only the promotions retriever populates these (one entry
	// per active promo with image_key set); other retrievers leave nil.
	Attachments []SnippetAttachment
}

// SnippetAttachment links a named entity from a snippet to an S3 image
// the worker can send via wa:send_image. Display name is used for
// fuzzy-matching against the AI's reply text — case-insensitive
// substring match is fine for the v1 use case (promo names like
// "HEMAT20" or "Diskon Lebaran").
type SnippetAttachment struct {
	Name     string
	ImageKey string
}

// Retriever is the interface each typed retriever implements.
//
// `tokens` is the search corpus — built from the current message PLUS recent
// conversation history so entity references carry over ("harganya berapa?"
// after "Teh Original tersedia").
//
// `isCatalog` is computed by the dispatcher from the CURRENT message only.
// Carrying it as a separate flag prevents history words like "menu" from
// flipping a specific question into catalog mode.
type Retriever interface {
	Retrieve(ctx context.Context, db queries.DBTX, tenantID pgtype.UUID,
		remoteJid string, tokens []string, isCatalog bool, verbose bool) ([]Snippet, error)
}
