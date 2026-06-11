// Package handlers — wa_login.go exposes the two PUBLIC (no auth, no
// tenant middleware) endpoints used by the staff WhatsApp OTP login
// flow. Both are pre-session: the user is by definition unauthenticated
// when they hit these routes.
//
//	POST /v1/auth/wa-login/request
//	  in:  { tenantSlug, phone }
//	  out: { instancePhone, deepLink, tenantName, expectedReplyWithinSec }
//	  effect: tells the caller WHERE on WhatsApp to send the "minta otp"
//	          message. No OTP is generated here — the OTP is only ever
//	          generated when an inbound WhatsApp message arrives at the
//	          tenant's instance (see walogin.Service.HandleInboundOtpRequest).
//	          This split is what makes the flow ban-safe: every OTP
//	          conversation is user-initiated.
//
//	POST /v1/auth/wa-login/verify
//	  in:  { tenantSlug, phone, otp }
//	  out: { userId, authEmail?, tenantId }
//	  effect: validates the 6-digit code against the latest unconsumed
//	          unexpired OTP for (tenant, phone). On match, consumes the
//	          row and returns the staff identity. The web layer mints
//	          a Supabase session from that identity via the admin
//	          magic-link flow.
//
// Phone-enumeration protection: BOTH endpoints return generic errors
// for "unknown tenant" / "tenant doesn't have WA login" / "phone not
// registered" — same shape, same status, no signal to an attacker.
package handlers

import (
	"errors"
	"fmt"
	"net/url"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/walogin"
)

// WALoginHandler bundles the queries + walogin service used by both
// endpoints. Constructed once in server.go and passed by value into
// fiber.App.
type WALoginHandler struct {
	Q   *queries.Queries
	Svc *walogin.Service
}

func NewWALogin(q *queries.Queries, svc *walogin.Service) *WALoginHandler {
	return &WALoginHandler{Q: q, Svc: svc}
}

// expectedReplyWithinSec is what we tell the web app to display as the
// "expected reply window" — wraps the typical send latency through the
// asynq pipeline + whatsmeow. Padded above the observed p99 so users
// don't see "we should have replied" before we actually have.
const expectedReplyWithinSec = 30

type waLoginRequestIn struct {
	TenantSlug string `json:"tenantSlug"`
	Phone      string `json:"phone"`
}

type waLoginRequestOut struct {
	InstancePhone          string `json:"instancePhone"`
	DeepLink               string `json:"deepLink"`
	TenantName             string `json:"tenantName"`
	ExpectedReplyWithinSec int    `json:"expectedReplyWithinSec"`
}

// Request resolves the tenant + paid-tier+connected instance and
// returns the wa.me deep link. NEVER reveals whether the supplied
// phone is registered staff — that's checked downstream in the
// inbound handler, silently.
//
// The phone parameter is accepted but unused in this endpoint (beyond
// basic format validation). The wa.me URL is identical for every
// caller of a given tenant; we still take phone in the body for
// future audit / rate-limiting expansion.
func (h *WALoginHandler) Request(c *fiber.Ctx) error {
	var req waLoginRequestIn
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid body")
	}
	if req.TenantSlug == "" {
		return badRequest(c, "tenantSlug is required")
	}
	if req.Phone == "" {
		return badRequest(c, "phone is required")
	}

	// Normalize phone so the format check below is meaningful (and so
	// future rate-limit keys are stable). We DO NOT use the result to
	// look up staff here — that's the inbound handler's job.
	if walogin.NormalizeIDPhone(req.Phone) == "" {
		return badRequest(c, "phone format not recognized")
	}

	t, err := h.Q.GetTenantBySlug(c.UserContext(), req.TenantSlug)
	if err != nil {
		// Same response shape as "tenant doesn't have WA login" so an
		// attacker can't enumerate slugs.
		if errors.Is(err, pgx.ErrNoRows) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "wa_login_unavailable",
			})
		}
		return internalError(c, err)
	}

	inst, err := h.Svc.ResolveLoginTarget(c.UserContext(), t.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// No instance OR instance not connected OR tier not basic+
			// OR otp_login_enabled = false. Same generic response.
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "wa_login_unavailable",
			})
		}
		return internalError(c, err)
	}
	if !inst.PhoneNumber.Valid || inst.PhoneNumber.String == "" {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "wa_login_unavailable",
		})
	}

	prefilledText := "Minta OTP Login Vintra"
	deepLink := fmt.Sprintf(
		"https://wa.me/%s?text=%s",
		inst.PhoneNumber.String,
		url.QueryEscape(prefilledText),
	)

	return c.JSON(waLoginRequestOut{
		InstancePhone:          inst.PhoneNumber.String,
		DeepLink:               deepLink,
		TenantName:             t.BusinessName,
		ExpectedReplyWithinSec: expectedReplyWithinSec,
	})
}

type waLoginVerifyIn struct {
	TenantSlug string `json:"tenantSlug"`
	Phone      string `json:"phone"`
	OTP        string `json:"otp"`
}

type waLoginVerifyOut struct {
	UserID    string `json:"userId"`
	AuthEmail string `json:"authEmail,omitempty"`
	TenantID  string `json:"tenantId"`
}

// Verify checks the OTP against the active row for (tenant, phone)
// and returns the staff identity on success. Web layer takes the
// response and mints a Supabase session.
func (h *WALoginHandler) Verify(c *fiber.Ctx) error {
	var req waLoginVerifyIn
	if err := c.BodyParser(&req); err != nil {
		return badRequest(c, "invalid body")
	}
	if req.TenantSlug == "" || req.Phone == "" || req.OTP == "" {
		return badRequest(c, "tenantSlug, phone, and otp are required")
	}
	if len(req.OTP) != walogin.OtpDigits {
		// Constant-time error — same shape as a hash mismatch.
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "otp_invalid",
		})
	}

	normalized := walogin.NormalizeIDPhone(req.Phone)
	if normalized == "" {
		return badRequest(c, "phone format not recognized")
	}

	t, err := h.Q.GetTenantBySlug(c.UserContext(), req.TenantSlug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Same shape as otp_invalid so an attacker can't tell
			// "wrong tenant" from "wrong code".
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "otp_invalid",
			})
		}
		return internalError(c, err)
	}

	// Per-phone verify rate limit. The MaxVerifyAttempts cap on the OTP
	// row would already block a single-OTP brute force, but this limit
	// throttles scripts that request multiple OTPs and burn through
	// guess budgets in parallel.
	if h.Svc.VerifyLimiter != nil {
		if err := h.Svc.VerifyLimiter.Allow(c.UserContext(), db.UUIDString(t.ID), normalized); err != nil {
			if errors.Is(err, walogin.ErrRateLimited) {
				return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
					"error": "rate_limited",
				})
			}
			// Redis blip — log + allow (fail-open). The OTP-row attempt
			// cap is still enforced inside VerifyAndConsumeOtp, so an
			// attacker can't actually exploit this.
			return internalError(c, err)
		}
	}

	result, err := h.Svc.VerifyAndConsumeOtp(c.UserContext(), t.ID, normalized, req.OTP)
	if err != nil {
		switch {
		case errors.Is(err, walogin.ErrOtpInvalid):
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "otp_invalid",
			})
		case errors.Is(err, walogin.ErrOtpTooManyAttempts):
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "otp_too_many_attempts",
			})
		default:
			return internalError(c, err)
		}
	}

	return c.JSON(waLoginVerifyOut{
		UserID:    result.UserID,
		AuthEmail: result.AuthEmail,
		TenantID:  result.TenantID,
	})
}
