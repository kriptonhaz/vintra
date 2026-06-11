package walogin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	queries "github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
)

// OtpTTL is how long an issued OTP stays valid. 5 minutes — long enough
// for the staff to switch apps and type 6 digits, short enough that a
// stolen screenshot has tiny attack surface.
const OtpTTL = 5 * time.Minute

// MaxVerifyAttempts caps how many guesses are allowed against a single
// OTP row before it's force-consumed. The verify endpoint enforces
// this; codified here as a constant so PR 3 imports it.
const MaxVerifyAttempts = 3

// paidTiers gates the feature to basic+ subscribers. Mirrors the SQL
// filter in GetWaInstanceForLogin / GetInstanceForOtp so both Go
// branches and SQL agree on what "WA login enabled" means.
var paidTiers = map[string]bool{
	"basic":      true,
	"komplit":    true,
	"enterprise": true,
}

// WASendPayload mirrors the one in queue/tasks. Re-declared here to
// avoid an import cycle (tasks imports walogin, not the other way
// around). The shape MUST stay in sync with queue/tasks.WASendPayload.
type wASendPayload struct {
	MessageID string `json:"messageId"`
}

// Service is the orchestration layer used by both the inbound detector
// (queue/tasks/wa_incoming.go) and the public HTTP endpoints
// (http/handlers/wa_login.go). Constructed once at boot.
type Service struct {
	Q             *queries.Queries
	Asynq         *asynq.Client
	ReqLimiter    *RequestLimiter
	VerifyLimiter *RequestLimiter
}

// NewService wires the dependencies a Service needs. The two limiters
// gate DIFFERENT things — see comments on the struct fields:
//
//   - ReqLimiter    → caps OTP GENERATION at the source phone (inbound
//                     WhatsApp "minta otp"). Mitigates an attacker who
//                     spams inbound to burn the tenant's WA send budget.
//   - VerifyLimiter → caps OTP GUESSES at the source phone (public
//                     /verify endpoint). Mitigates online brute-force
//                     of an outstanding code; works alongside the per-
//                     OTP MaxVerifyAttempts cap (the limiter blocks
//                     after the row would already be consumed, so this
//                     is mostly a slowdown for a script firing many
//                     codes against many phones).
func NewService(
	q *queries.Queries,
	asynqClient *asynq.Client,
	reqLimiter, verifyLimiter *RequestLimiter,
) *Service {
	return &Service{
		Q:             q,
		Asynq:         asynqClient,
		ReqLimiter:    reqLimiter,
		VerifyLimiter: verifyLimiter,
	}
}

// HandleInboundOtpRequest is the detector's entry point. Returns
// `handled=true` only when an OTP was actually issued — meaning the
// caller MUST skip downstream AI dispatch for this message. Returns
// `handled=false` for every "not eligible" branch (instance flag off,
// no matching staff, rate-limited, etc.) so the message flows through
// the normal AI path unaffected.
//
// Errors are returned but the caller logs and continues — failing the
// asynq task would re-run the inbound persistence, double-counting the
// message in the inbox.
func (s *Service) HandleInboundOtpRequest(
	ctx context.Context,
	instanceID, tenantID, remoteJid, body string,
) (handled bool, err error) {
	// Cheap guard before any DB work.
	if !IsOtpRequest(body) {
		return false, nil
	}

	// Per-instance kill switch + tier check. Both run in one round-trip.
	instUUID, err := db.ParseUUID(instanceID)
	if err != nil {
		return false, fmt.Errorf("parse instance id: %w", err)
	}
	inst, err := s.Q.GetInstanceForOtp(ctx, instUUID)
	if err != nil {
		return false, fmt.Errorf("get instance for otp: %w", err)
	}
	if !inst.OtpLoginEnabled || !inst.SubscriptionActive || !paidTiers[inst.Tier] {
		return false, nil
	}

	// Pull the sender's phone from the JID. LID-only inbounds yield ""
	// and silently no-op — login over LID isn't supported.
	phone := PhoneFromJID(remoteJid)
	if phone == "" {
		return false, nil
	}

	// Look up opt-in staff for this tenant, normalize-compare phones in
	// Go. Returning nothing on miss is the desired behavior — we DO NOT
	// reply to non-staff senders even if they happen to type "otp".
	tenantUUID, err := db.ParseUUID(tenantID)
	if err != nil {
		return false, fmt.Errorf("parse tenant id: %w", err)
	}
	staff, err := s.findOptInStaff(ctx, tenantUUID, phone)
	if err != nil {
		return false, err
	}
	if staff == nil {
		return false, nil
	}

	// Per-phone rate limit. ErrRateLimited is the only soft error we
	// swallow — anything else is logged and we still return handled=true
	// so the message doesn't get an AI reply on top of nothing.
	if s.ReqLimiter != nil {
		if rlErr := s.ReqLimiter.Allow(ctx, tenantID, phone); rlErr != nil {
			if errors.Is(rlErr, ErrRateLimited) {
				slog.Warn("wa-login: rate-limited",
					"tenant", tenantID, "phone", phone)
				return true, nil
			}
			slog.Error("wa-login: ratelimit error, allowing",
				"err", rlErr)
		}
	}

	// Invalidate any prior unconsumed codes for this phone — only the
	// latest OTP is valid. Critical when the user double-fires the
	// wa.me link.
	if err := s.Q.InvalidatePriorWaLoginOtps(ctx, queries.InvalidatePriorWaLoginOtpsParams{
		TenantID: tenantUUID,
		Phone:    phone,
	}); err != nil {
		return false, fmt.Errorf("invalidate prior otps: %w", err)
	}

	code, err := GenerateOtp()
	if err != nil {
		return false, fmt.Errorf("generate otp: %w", err)
	}
	hash, err := HashOtp(code)
	if err != nil {
		return false, fmt.Errorf("hash otp: %w", err)
	}

	expiresAt := time.Now().Add(OtpTTL)
	if _, err := s.Q.CreateWaLoginOtp(ctx, queries.CreateWaLoginOtpParams{
		TenantID:   tenantUUID,
		InstanceID: instUUID,
		Phone:      phone,
		RemoteJid:  remoteJid,
		OtpHash:    hash,
		ExpiresAt:  pgtype.Timestamptz{Time: expiresAt, Valid: true},
	}); err != nil {
		return false, fmt.Errorf("create otp row: %w", err)
	}

	// Send the cleartext code back over WhatsApp. We create a normal
	// outbound wa_messages row + enqueue wa:send so the existing rate
	// limiter / retry / status-tracking pipeline applies.
	if err := s.enqueueOtpReply(ctx, tenantUUID, instUUID, remoteJid, code); err != nil {
		return false, fmt.Errorf("enqueue otp reply: %w", err)
	}

	slog.Info("wa-login: otp issued",
		"tenant", tenantID,
		"instance", instanceID,
		"member", db.UUIDString(staff.ID),
	)
	return true, nil
}

// OptInStaff is the trimmed projection returned by findOptInStaff.
// Mirrors ListOptInTenantMembersByTenantRow but only the fields the
// service + verify endpoint actually use.
type OptInStaff struct {
	ID           pgtype.UUID
	UserID       pgtype.UUID
	WaLoginEmail pgtype.Text
	TenantSlug   string
}

// VerifyResult is what the public /wa-login/verify endpoint returns to
// the web layer on a successful OTP match. The web then uses these
// fields to mint a Supabase session via the admin magic-link flow.
//
//   - UserID is always set on success — points to a Supabase auth user.
//   - AuthEmail is set ONLY when the staff has a synthetic email (i.e.
//     they were invited via the phone-only path). NULL/empty means the
//     web layer must resolve the user's real email via supabase admin
//     getUserById(userId).
type VerifyResult struct {
	UserID    string
	AuthEmail string
	TenantID  string
}

// ErrOtpInvalid is returned by VerifyOtp when the supplied code didn't
// match (no active row, mismatch, or expired). The handler returns 400
// for all of these — never reveal which case occurred to avoid leaking
// "this phone has a pending OTP" intelligence.
var ErrOtpInvalid = errors.New("walogin: otp invalid")

// ErrOtpTooManyAttempts is returned when the OTP row has been guessed
// against MaxVerifyAttempts times. The row is force-consumed before
// this error returns, so subsequent attempts get ErrOtpInvalid until
// a new OTP is requested via WhatsApp.
var ErrOtpTooManyAttempts = errors.New("walogin: too many attempts")

// VerifyAndConsumeOtp validates a user-supplied code against the latest
// active OTP for (tenant, phone). On success the row is consumed and
// the function returns the staff identity the caller needs to mint a
// session. The row is also consumed after MaxVerifyAttempts failed
// guesses (3) — at which point a fresh OTP must be requested.
//
// `phone` MUST be normalized — callers should run NormalizeIDPhone on
// the user-supplied form before passing it in. The query is a strict
// equality against the stored row's phone column.
//
// Concurrency: GetActiveWaLoginOtp does SELECT ... FOR UPDATE, so two
// concurrent verifies against the same OTP row serialize at the DB
// layer. The first to commit wins; the second sees consumed_at != NULL
// and gets ErrOtpInvalid.
func (s *Service) VerifyAndConsumeOtp(
	ctx context.Context,
	tenantID pgtype.UUID,
	phone, code string,
) (*VerifyResult, error) {
	row, err := s.Q.GetActiveWaLoginOtp(ctx, queries.GetActiveWaLoginOtpParams{
		TenantID: tenantID,
		Phone:    phone,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrOtpInvalid
		}
		return nil, fmt.Errorf("get active otp: %w", err)
	}

	// Increment attempts BEFORE hash compare so the cap applies even if
	// the hash compare itself errors out.
	if err := s.Q.IncrementWaLoginOtpAttempts(ctx, row.ID); err != nil {
		return nil, fmt.Errorf("increment attempts: %w", err)
	}
	if int(row.Attempts)+1 > MaxVerifyAttempts {
		// Past the cap — kill the row so further guesses fall through
		// to "no active otp" (ErrOtpInvalid).
		if cErr := s.Q.ConsumeWaLoginOtp(ctx, row.ID); cErr != nil {
			slog.Error("wa-login: failed to consume over-limit otp",
				"id", db.UUIDString(row.ID), "err", cErr)
		}
		return nil, ErrOtpTooManyAttempts
	}

	if err := VerifyOtp(code, row.OtpHash); err != nil {
		return nil, ErrOtpInvalid
	}

	// Consume the row so it can't be replayed. Do this BEFORE the
	// staff lookup so a panic in the staff lookup still kills the
	// OTP — better to over-consume than to leave a valid code lying
	// around.
	if err := s.Q.ConsumeWaLoginOtp(ctx, row.ID); err != nil {
		return nil, fmt.Errorf("consume otp: %w", err)
	}

	staff, err := s.findOptInStaff(ctx, tenantID, phone)
	if err != nil {
		return nil, err
	}
	if staff == nil {
		// Should never happen — the OTP was issued against this same
		// (tenant, phone) pair. If we see this branch, the member was
		// opted out between request and verify. Treat as invalid.
		return nil, ErrOtpInvalid
	}

	result := &VerifyResult{
		UserID:   db.UUIDString(staff.UserID),
		TenantID: db.UUIDString(tenantID),
	}
	if staff.WaLoginEmail.Valid {
		result.AuthEmail = staff.WaLoginEmail.String
	}

	// Audit log — one structured line per successful WA login. Lands in
	// the same slog stream as the rest of the api so existing log
	// shipping picks it up without new infra. Phone is logged in its
	// already-normalized form; never log the OTP itself.
	slog.Info("wa-login: verify success",
		"tenant", db.UUIDString(tenantID),
		"member", db.UUIDString(staff.ID),
		"user", result.UserID,
		"phone", phone,
		"synthetic_email", staff.WaLoginEmail.Valid,
	)
	return result, nil
}

// ResolveLoginTarget looks up the connected, OTP-enabled, paid-tier WA
// instance for a tenant. Used by the public /wa-login/request endpoint
// to (a) confirm the tenant has the feature live and (b) return the
// instance's phone number so the login page can build the wa.me deep
// link. The returned instance phone may be NULL (instance paired but
// phone_number not yet populated) — handler returns 409 in that case.
func (s *Service) ResolveLoginTarget(
	ctx context.Context,
	tenantID pgtype.UUID,
) (queries.GetWaInstanceForLoginRow, error) {
	return s.Q.GetWaInstanceForLogin(ctx, tenantID)
}

// findOptInStaff returns the staff record whose stored phone equals
// the inbound sender's E.164-normalized phone, or nil if no opt-in
// staff matches. Backed by the partial index
// `tenant_members_wa_login_phone_idx` (migration 0074) — O(log N) over
// the opt-in subset, not the per-tenant linear scan we used pre-0074.
//
// Both sides normalize via the same logic (coerceStorablePhone in TS,
// NormalizeIDPhone in Go), so a strict equality lookup is sufficient.
// Legacy rows that survive the 0074 backfill in non-normalized form
// (out-of-range / malformed) simply won't match — which is the same
// behavior the old scan produced for those edges.
func (s *Service) findOptInStaff(
	ctx context.Context,
	tenantID pgtype.UUID,
	normalizedPhone string,
) (*OptInStaff, error) {
	row, err := s.Q.GetOptInTenantMemberByPhone(ctx, queries.GetOptInTenantMemberByPhoneParams{
		TenantID: tenantID,
		Phone:    pgtype.Text{String: normalizedPhone, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("lookup opt-in staff: %w", err)
	}
	return &OptInStaff{
		ID:           row.ID,
		UserID:       row.UserID,
		WaLoginEmail: row.WaLoginEmail,
		TenantSlug:   row.TenantSlug,
	}, nil
}

// enqueueOtpReply creates a wa_messages row in 'pending' status and
// enqueues a wa:send task so the existing pipeline handles delivery,
// rate-limiting, retries, and 'sent'/'failed' bookkeeping. We DO NOT
// invoke whatsmeow directly here — that would bypass the rate limiter
// and risk a ban on a hot phone.
func (s *Service) enqueueOtpReply(
	ctx context.Context,
	tenantID, instanceID pgtype.UUID,
	toJid, code string,
) error {
	body := fmt.Sprintf(
		"Kode login Vintra Anda: %s\n\nBerlaku 5 menit. Jangan bagikan kode ini ke siapa pun.",
		code,
	)
	msg, err := s.Q.CreateOutboundMessage(ctx, queries.CreateOutboundMessageParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
		RemoteJid:  toJid,
		Type:       "text",
		Body:       pgtype.Text{String: body, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("insert outbound: %w", err)
	}
	payload, err := json.Marshal(wASendPayload{MessageID: db.UUIDString(msg.ID)})
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	task := asynq.NewTask(queue.TaskWASend, payload)
	// Wider context than the inbound task's — the enqueue talks to
	// Redis and we want it to land even if the parent task ctx is
	// about to be canceled.
	enqueueCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := s.Asynq.EnqueueContext(enqueueCtx, task,
		asynq.Queue(queue.QueueWASend),
		asynq.MaxRetry(2),
		asynq.Timeout(30*time.Second),
	); err != nil {
		return fmt.Errorf("enqueue wa:send: %w", err)
	}
	return nil
}
