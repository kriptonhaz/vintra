package tasks

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/jpeg" // register JPEG decoder for base design / mark
	"image/png"
	"log/slog"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // register WebP decoder (decode-only)

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	"github.com/kriptonhaz/vintra/apps/api/internal/storage"
)

// LoyaltyRenderCardPayload identifies the program whose stamp-card
// states should be (re)rendered. Tenant id is carried so the worker can
// scope every query — the enqueuer (web → internal endpoint) has already
// verified the caller owns the program.
type LoyaltyRenderCardPayload struct {
	TenantID  string `json:"tenantId"`
	ProgramID string `json:"programId"`
}

// stampCardLayout mirrors the TS StampCardLayout the grid-overlay editor
// persists into loyalty_stamp_programs.card_layout. All coordinates and
// sizes are 0..1 fractions of the base design so rendering is
// resolution-independent.
type stampCardLayout struct {
	Cols  int `json:"cols"`
	Rows  int `json:"rows"`
	Cells []struct {
		X float64 `json:"x"`
		Y float64 `json:"y"`
	} `json:"cells"`
	MarkScale   float64 `json:"markScale"`
	MarkOpacity float64 `json:"markOpacity"`
}

// LoyaltyRenderCardHandler pre-renders every fill state (0..N stamps) of
// a loyalty stamp card into permanent S3 objects, one row per state in
// loyalty_stamp_program_cards. Rendering happens here — off the WhatsApp
// hot path — so sending a card later is a single key lookup. Triggered
// whenever the merchant changes the design, stamp mark, layout, or
// stamps_required.
type LoyaltyRenderCardHandler struct {
	DB queries.DBTX
	S3 *storage.Client
}

// RegisterLoyaltyRenderCard wires the handler for the
// loyalty:render_card task type. Called once at boot from main.go.
func RegisterLoyaltyRenderCard(mux *asynq.ServeMux, h *LoyaltyRenderCardHandler) {
	mux.HandleFunc(queue.TaskLoyaltyRenderCard, h.process)
}

func (h *LoyaltyRenderCardHandler) process(ctx context.Context, t *asynq.Task) error {
	var p LoyaltyRenderCardPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal: %w: %w", err, asynq.SkipRetry)
	}

	programID, err := db.ParseUUID(p.ProgramID)
	if err != nil {
		return fmt.Errorf("parse program id: %w: %w", err, asynq.SkipRetry)
	}
	tenantID, err := db.ParseUUID(p.TenantID)
	if err != nil {
		return fmt.Errorf("parse tenant id: %w: %w", err, asynq.SkipRetry)
	}

	if h.S3 == nil {
		// Can't render without S3 — needs a redeploy with creds. Don't
		// burn retries; leave status 'pending' so a later trigger picks
		// it up once configured.
		return fmt.Errorf("s3 client unavailable: %w", asynq.SkipRetry)
	}

	var (
		designKey, markKey pgtype.Text
		layoutRaw          []byte
		stampsRequired     int32
	)
	row := h.DB.QueryRow(ctx, `
		SELECT card_design_key, stamp_mark_key, card_layout, stamps_required
		FROM loyalty_stamp_programs
		WHERE id = $1 AND tenant_id = $2`,
		programID, tenantID)
	if err := row.Scan(&designKey, &markKey, &layoutRaw, &stampsRequired); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("loyalty:render_card: program gone, skipping", "program", p.ProgramID)
			return nil
		}
		return fmt.Errorf("load program: %w", err)
	}

	// A program without a complete design can't be rendered. This is a
	// caller bug (the web should only trigger once all three are set),
	// so mark failed and skip retry rather than loop forever.
	if !designKey.Valid || designKey.String == "" ||
		!markKey.Valid || markKey.String == "" ||
		len(layoutRaw) == 0 || stampsRequired <= 0 {
		h.markFailed(ctx, programID, tenantID)
		return fmt.Errorf("incomplete card design: %w", asynq.SkipRetry)
	}

	var layout stampCardLayout
	if err := json.Unmarshal(layoutRaw, &layout); err != nil {
		h.markFailed(ctx, programID, tenantID)
		return fmt.Errorf("bad card_layout json: %w: %w", err, asynq.SkipRetry)
	}
	if len(layout.Cells) < int(stampsRequired) {
		h.markFailed(ctx, programID, tenantID)
		return fmt.Errorf("layout has %d cells, need %d: %w",
			len(layout.Cells), stampsRequired, asynq.SkipRetry)
	}
	if layout.MarkScale <= 0 {
		layout.MarkScale = 0.12
	}
	if layout.MarkOpacity <= 0 {
		layout.MarkOpacity = 1
	}

	// Fetch + decode the two source images. S3 fetch errors are
	// transient — let asynq retry.
	designBytes, err := h.S3.Get(ctx, designKey.String)
	if err != nil {
		return fmt.Errorf("s3 get design %s: %w", designKey.String, err)
	}
	markBytes, err := h.S3.Get(ctx, markKey.String)
	if err != nil {
		return fmt.Errorf("s3 get mark %s: %w", markKey.String, err)
	}

	designImg, _, err := image.Decode(bytes.NewReader(designBytes))
	if err != nil {
		h.markFailed(ctx, programID, tenantID)
		return fmt.Errorf("decode design: %w: %w", err, asynq.SkipRetry)
	}
	markImg, _, err := image.Decode(bytes.NewReader(markBytes))
	if err != nil {
		h.markFailed(ctx, programID, tenantID)
		return fmt.Errorf("decode mark: %w: %w", err, asynq.SkipRetry)
	}

	bounds := designImg.Bounds()
	w, hgt := bounds.Dx(), bounds.Dy()

	// Pre-scale the mark once — it's the same size in every cell.
	markW := int(layout.MarkScale * float64(w))
	if markW < 1 {
		markW = 1
	}
	mb := markImg.Bounds()
	markH := int(float64(markW) * float64(mb.Dy()) / float64(mb.Dx()))
	if markH < 1 {
		markH = 1
	}
	scaledMark := image.NewRGBA(image.Rect(0, 0, markW, markH))
	xdraw.CatmullRom.Scale(scaledMark, scaledMark.Bounds(), markImg, mb, xdraw.Over, nil)

	// Opacity mask (nil = fully opaque fast path).
	var opacityMask image.Image
	if layout.MarkOpacity < 0.999 {
		opacityMask = image.NewUniform(color.Alpha{A: uint8(layout.MarkOpacity * 255)})
	}

	// Base canvas, normalized to RGBA at the origin. We render
	// incrementally: state n is state n-1 plus one more mark.
	canvas := image.NewRGBA(image.Rect(0, 0, w, hgt))
	draw.Draw(canvas, canvas.Bounds(), designImg, bounds.Min, draw.Src)

	upload := func(stampCount int) error {
		var buf bytes.Buffer
		if err := png.Encode(&buf, canvas); err != nil {
			return fmt.Errorf("encode png n=%d: %w", stampCount, err)
		}
		key := fmt.Sprintf("%s/stamps/%s/card-%d.png", p.TenantID, p.ProgramID, stampCount)
		if err := h.S3.Upload(ctx, key, buf.Bytes(), "image/png", "kind=loyalty-card"); err != nil {
			return fmt.Errorf("upload n=%d: %w", stampCount, err)
		}
		if _, err := h.DB.Exec(ctx, `
			INSERT INTO loyalty_stamp_program_cards (tenant_id, program_id, stamp_count, image_key)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (program_id, stamp_count)
			DO UPDATE SET image_key = EXCLUDED.image_key, created_at = now()`,
			tenantID, programID, stampCount, key); err != nil {
			return fmt.Errorf("upsert card row n=%d: %w", stampCount, err)
		}
		return nil
	}

	// State 0 = bare design, then one mark per stamp.
	if err := upload(0); err != nil {
		return err
	}
	for i := 0; i < int(stampsRequired); i++ {
		drawMark(canvas, scaledMark, opacityMask, layout.Cells[i].X, layout.Cells[i].Y, w, hgt)
		if err := upload(i + 1); err != nil {
			return err
		}
	}

	// Drop any stale states left over from a larger previous
	// stamps_required (shrinking the program).
	if _, err := h.DB.Exec(ctx, `
		DELETE FROM loyalty_stamp_program_cards
		WHERE program_id = $1 AND stamp_count > $2`,
		programID, stampsRequired); err != nil {
		slog.Warn("loyalty:render_card: stale cleanup failed",
			"program", p.ProgramID, "err", err)
	}

	if _, err := h.DB.Exec(ctx, `
		UPDATE loyalty_stamp_programs
		SET card_render_status = 'ready', card_rendered_at = now()
		WHERE id = $1 AND tenant_id = $2`,
		programID, tenantID); err != nil {
		return fmt.Errorf("mark ready: %w", err)
	}

	slog.Info("loyalty:render_card: rendered card states",
		"program", p.ProgramID, "states", stampsRequired+1)
	return nil
}

// drawMark composites the pre-scaled mark centered at the normalized
// (nx, ny) point on the canvas, honoring the opacity mask if set.
func drawMark(canvas *image.RGBA, mark image.Image, mask image.Image, nx, ny float64, w, h int) {
	mb := mark.Bounds()
	cx := int(nx * float64(w))
	cy := int(ny * float64(h))
	r := image.Rect(
		cx-mb.Dx()/2,
		cy-mb.Dy()/2,
		cx-mb.Dx()/2+mb.Dx(),
		cy-mb.Dy()/2+mb.Dy(),
	)
	if mask == nil {
		draw.Draw(canvas, r, mark, mb.Min, draw.Over)
		return
	}
	draw.DrawMask(canvas, r, mark, mb.Min, mask, image.Point{}, draw.Over)
}

func (h *LoyaltyRenderCardHandler) markFailed(ctx context.Context, programID, tenantID pgtype.UUID) {
	if _, err := h.DB.Exec(ctx, `
		UPDATE loyalty_stamp_programs
		SET card_render_status = 'failed'
		WHERE id = $1 AND tenant_id = $2`,
		programID, tenantID); err != nil {
		slog.Error("loyalty:render_card: failed to mark failed",
			"program", db.UUIDString(programID), "err", err)
	}
}
