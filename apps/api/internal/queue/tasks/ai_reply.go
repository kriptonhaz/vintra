package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/kriptonhaz/vintra/apps/api/internal/ai"
	"github.com/kriptonhaz/vintra/apps/api/internal/conversation"
	"github.com/kriptonhaz/vintra/apps/api/internal/db"
	"github.com/kriptonhaz/vintra/apps/api/internal/db/queries/generated"
	"github.com/kriptonhaz/vintra/apps/api/internal/handoff"
	"github.com/kriptonhaz/vintra/apps/api/internal/queue"
	"github.com/kriptonhaz/vintra/apps/api/internal/rag"
	"github.com/kriptonhaz/vintra/apps/api/internal/whatsapp"
	goredis "github.com/redis/go-redis/v9"
)

// AIReplyPayload is the JSON shape enqueued by the wa:incoming worker.
type AIReplyPayload struct {
	TenantID   string `json:"tenantId"`
	InstanceID string `json:"instanceId"`
	RemoteJid  string `json:"remoteJid"`
	MessageID  string `json:"messageId"` // wa_messages.id of the inbound row
}

// AIReplyHandler holds dependencies for the ai:reply worker.
type AIReplyHandler struct {
	Q           *queries.Queries
	DB          queries.DBTX // raw pool for RAG retrievers
	Redis       *goredis.Client
	AsynqClient *asynq.Client
	AiSvc       *ai.Service
	Loader      *conversation.Loader
}

// RegisterAIReply wires the handler into the given mux. Called once at
// boot from cmd/api/main.go.
func RegisterAIReply(mux *asynq.ServeMux, h *AIReplyHandler) {
	mux.HandleFunc(queue.TaskAIReply, h.process)
}

const aiReplyLockTTL = 60 * time.Second

func (h *AIReplyHandler) process(ctx context.Context, t *asynq.Task) error {
	var p AIReplyPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("ai:reply unmarshal: %w: %w", err, asynq.SkipRetry)
	}

	// Per-(instance, jid) Redis lock — prevents two parallel replies
	// for the same chat (burst protection).
	lockKey := fmt.Sprintf("lock:ai:%s:%s", p.InstanceID, p.RemoteJid)
	ok, err := h.Redis.SetNX(ctx, lockKey, "1", aiReplyLockTTL).Result()
	if err != nil {
		return fmt.Errorf("ai:reply lock: %w", err)
	}
	if !ok {
		slog.Debug("ai:reply skipped (lock held)", "instance", p.InstanceID, "jid", p.RemoteJid)
		return nil
	}
	defer h.Redis.Del(ctx, lockKey)

	instanceID, err := db.ParseUUID(p.InstanceID)
	if err != nil {
		return fmt.Errorf("ai:reply parse instance id: %w: %w", err, asynq.SkipRetry)
	}
	tenantID, err := db.ParseUUID(p.TenantID)
	if err != nil {
		return fmt.Errorf("ai:reply parse tenant id: %w: %w", err, asynq.SkipRetry)
	}
	msgID, err := db.ParseUUID(p.MessageID)
	if err != nil {
		return fmt.Errorf("ai:reply parse message id: %w: %w", err, asynq.SkipRetry)
	}

	// Fetch instance to get AI settings.
	instance, err := h.Q.GetWaInstance(ctx, queries.GetWaInstanceParams{
		ID:       instanceID,
		TenantID: tenantID,
	})
	if err != nil {
		return fmt.Errorf("ai:reply get instance: %w", err)
	}

	// Double-check: still enabled?
	if !instance.AiEnabled {
		slog.Debug("ai:reply skipped (ai disabled)", "instance", p.InstanceID)
		return nil
	}

	// Handoff workflow (JUR-74) — pre-reply check. If this contact is
	// flagged as needs_human, AI auto-reply is paused. Two exit paths:
	//   1. Manually flagged (admin clicked toggle) and within
	//      auto-resume window → skip silently.
	//   2. Auto-resume window elapsed → clear flag, fall through to
	//      reply normally, fire one "AI aktif kembali" admin alert.
	contact, err := h.Q.GetWaContactByJid(ctx, queries.GetWaContactByJidParams{
		InstanceID: instanceID,
		RemoteJid:  p.RemoteJid,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		// Don't block AI on a contact-fetch failure — log and continue.
		// Worst case: handoff state isn't enforced for this one message.
		slog.Warn("ai:reply: failed to load contact for handoff check",
			"instance", p.InstanceID, "jid", p.RemoteJid, "err", err)
	}
	if err == nil && contact.NeedsHuman {
		autoResumeMs := int64(instance.HandoffAutoResumeHours) * int64(time.Hour/time.Millisecond)
		var elapsedMs int64
		if contact.HandoffAt.Valid {
			elapsedMs = time.Since(contact.HandoffAt.Time).Milliseconds()
		}
		if instance.HandoffAutoResumeHours > 0 && elapsedMs > autoResumeMs {
			// Auto-resume: customer's new message after the timeout
			// elapsed. Clear the flag and fall through to normal reply.
			if _, err := h.Q.ClearWaContactHandoff(ctx, queries.ClearWaContactHandoffParams{
				InstanceID: instanceID,
				RemoteJid:  p.RemoteJid,
			}); err != nil {
				slog.Warn("ai:reply: failed to auto-clear handoff",
					"instance", p.InstanceID, "jid", p.RemoteJid, "err", err)
			} else {
				slog.Info("ai:reply: handoff auto-resumed after timeout",
					"instance", p.InstanceID, "jid", p.RemoteJid,
					"hours", instance.HandoffAutoResumeHours)
				h.dispatchAdminNotification(ctx, instance, contact, "AI aktif kembali",
					"AI sudah aktif lagi setelah "+
						strconv.Itoa(int(instance.HandoffAutoResumeHours))+
						" jam. Pelanggan baru saja kirim pesan lagi.")
			}
		} else {
			slog.Debug("ai:reply skipped (handoff active)",
				"instance", p.InstanceID, "jid", p.RemoteJid)
			return nil
		}
	}

	// Enforce monthly reply limit based on tenant's WA subscription plan.
	waSettings, err := h.Q.GetWaSettings(ctx, tenantID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Debug("ai:reply skipped (no wa_settings — free tier)", "instance", p.InstanceID)
			return nil
		}
		return fmt.Errorf("ai:reply get wa settings: %w", err)
	}
	plan, err := h.Q.GetWaSubscriptionPlan(ctx, waSettings.Tier)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("ai:reply skipped (unknown plan tier)", "tier", waSettings.Tier)
			return nil
		}
		return fmt.Errorf("ai:reply get plan: %w", err)
	}
	usedReplies, err := h.Q.CountMonthlyAiReplies(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("ai:reply count replies: %w", err)
	}
	if int(usedReplies) >= int(plan.MaxMonthlyReplies) {
		slog.Warn("ai:reply limit reached",
			"instance", p.InstanceID,
			"tier", waSettings.Tier,
			"used", usedReplies,
			"limit", plan.MaxMonthlyReplies,
		)
		return nil
	}

	// Resolve the provider config. Order of preference:
	//   1. Instance pin — wa_instances.ai_provider_config_id.
	//   2. Platform default — single row with is_default = true.
	// If the pinned config is missing or inactive, we fall back to the
	// platform default rather than silently dropping the reply.
	var cfg queries.AiProviderConfig
	pinUsed := false
	if instance.AiProviderConfigID.Valid {
		c2, err := h.Q.GetAiProviderConfig(ctx, instance.AiProviderConfigID)
		switch {
		case err == nil && c2.IsActive:
			cfg = c2
			pinUsed = true
		case err != nil && !errors.Is(err, pgx.ErrNoRows):
			return fmt.Errorf("ai:reply get pinned provider config: %w", err)
		default:
			slog.Warn("ai:reply: pinned provider config missing or inactive — falling back to platform default",
				"instance", p.InstanceID,
				"pinnedConfigId", db.UUIDString(instance.AiProviderConfigID),
			)
		}
	}
	if !pinUsed {
		c2, err := h.Q.GetDefaultAiProviderConfig(ctx)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				slog.Warn("ai:reply: no default provider config — admin must configure one", "instance", p.InstanceID)
				return nil
			}
			return fmt.Errorf("ai:reply get provider config: %w", err)
		}
		cfg = c2
	}

	// Build a one-shot provider from the resolved config.
	var provider ai.AiProvider
	switch cfg.ProviderType {
	case "openai":
		provider = ai.NewOpenAIWithConfig(cfg.BaseUrl, cfg.ApiKey)
	case "gemini":
		provider = ai.NewGeminiWithConfig(cfg.BaseUrl, cfg.ApiKey)
	default:
		slog.Warn("ai:reply: unknown provider type in config", "type", cfg.ProviderType)
		return nil
	}

	// Model is always taken from the resolved config — the user picked
	// "DeepSeek — deepseek-v4-flash" as a pair, so the model must match
	// what the provider's base URL actually accepts. The legacy
	// wa_instances.ai_model column is intentionally NOT consulted —
	// it carried a stale 'gpt-4o-mini' default that would be sent to
	// non-OpenAI base URLs and rejected with HTTP 400.
	model := cfg.Model

	// Temperature: instance override, else 0.7.
	temp := 0.7
	if instance.AiTemperature.Valid && instance.AiTemperature.String != "" {
		if t2, err2 := strconv.ParseFloat(instance.AiTemperature.String, 64); err2 == nil {
			temp = t2
		}
	}

	// Fetch tenant for business context (name, category).
	tenant, err := h.Q.GetTenant(ctx, tenantID)
	if err != nil {
		return fmt.Errorf("ai:reply get tenant: %w", err)
	}

	// Fetch the inbound message body.
	inboundMsg, err := h.Q.GetWaMessage(ctx, msgID)
	if err != nil {
		return fmt.Errorf("ai:reply get message: %w", err)
	}
	incomingBody := ""
	if inboundMsg.Body.Valid {
		incomingBody = inboundMsg.Body.String
	}

	// Load conversation history.
	maxHistory := int(instance.AiMaxHistory)
	if maxHistory <= 0 {
		maxHistory = 10
	}
	history, err := h.Loader.GetTail(ctx, p.InstanceID, p.RemoteJid, maxHistory+1)
	if err != nil {
		return fmt.Errorf("ai:reply load history: %w", err)
	}
	// Drop the last entry — it's the inbound message we're replying to.
	if len(history) > 0 {
		history = history[:len(history)-1]
	}

	// RAG retrieval — load enabled tools and fetch context snippets.
	// waSettings.Tier="" (free) causes Retrieve to return empty immediately.
	// Errors are logged and skipped; RAG is enriching, not critical path.
	var retrieved []rag.Snippet
	var ragToolsCount, snippetsCount int
	var retrievalMs int64
	ragTools, ragErr := h.Q.GetInstanceEnabledRagTools(ctx, queries.GetInstanceEnabledRagToolsParams{
		InstanceID: instanceID,
		TenantID:   tenantID,
	})
	if ragErr != nil {
		slog.Warn("ai:reply: failed to load rag tools", "instance", p.InstanceID, "err", ragErr)
	} else if len(ragTools) > 0 {
		ragToolsCount = len(ragTools)
		ragStart := time.Now()
		// Build a retrieval body that includes recent conversation so entity
		// references carry over. Without this, a follow-up like "harganya
		// berapa?" can't find any product to search for — the prior message
		// that named "Teh Original" would be invisible to the retriever.
		//
		// The window matches the instance's aiMaxHistory setting — same
		// "Riwayat Pesan untuk Konteks" the LLM uses, so a tenant who bumps
		// the slider to 20 also gets 20 turns of entity carryover.
		retrievalBody := incomingBody
		for _, m := range history {
			retrievalBody = m.Content + "\n" + retrievalBody
		}
		retrieved, _ = rag.Retrieve(ctx, h.DB, tenantID, waSettings.Tier, p.RemoteJid, incomingBody, retrievalBody, ragTools, false)
		retrievalMs = time.Since(ragStart).Milliseconds()
		snippetsCount = len(retrieved)
	}

	msgs := ai.Build(ai.BuildInput{
		Instance:     instance,
		Tenant:       tenant,
		History:      history,
		IncomingBody: incomingBody,
		Retrieved:    retrieved,
	})
	msgs = ai.TruncateToBudget(msgs, 3000)

	// Pull admin-set per-1M-token pricing off the resolved config's TEXT
	// capability. `inputPrice` and `outputPrice` must both be > 0 to
	// override; `cacheHitPrice` is optional — DeepSeek-style providers set
	// it, OpenAI/Gemini leave it null (worker bills all input at the
	// regular rate). A config with no text capability row leaves all three
	// at zero — CompleteWith then falls back to the hardcoded pricing table.
	var inputPrice, outputPrice, cacheHitPrice float64
	if pricing, perr := h.Q.GetAiProviderTextPricing(ctx, cfg.ID); perr == nil {
		inputPrice, _ = numericToFloat(pricing.InputPricePer1mUsd)
		outputPrice, _ = numericToFloat(pricing.OutputPricePer1mUsd)
		cacheHitPrice, _ = numericToFloat(pricing.InputCacheHitPricePer1mUsd)
	} else if !errors.Is(perr, pgx.ErrNoRows) {
		return fmt.Errorf("ai:reply get text pricing: %w", perr)
	}

	out, err := h.AiSvc.CompleteWith(ctx, p.TenantID, "wa_reply", provider, ai.CompleteInput{
		Model:                      model,
		Messages:                   msgs,
		Temperature:                temp,
		InputPricePer1MUsd:         inputPrice,
		InputCacheHitPricePer1MUsd: cacheHitPrice,
		OutputPricePer1MUsd:        outputPrice,
	})
	if err != nil {
		slog.Error("ai:reply completion failed", "instance", p.InstanceID, "jid", p.RemoteJid, "err", err)
		return fmt.Errorf("ai:reply complete: %w", err)
	}

	// Guard against empty / whitespace-only AI output. Observed in
	// production: DeepSeek occasionally returns an empty completion
	// when the conversation context is ambiguous (e.g., customer
	// declines a handoff suggestion just after the contact came out
	// of handoff). Sending the empty body produces a blank WhatsApp
	// bubble at the customer's end and looks like the AI ghosted them.
	//
	// Instead, send a polite "something went wrong, please rephrase"
	// fallback. This:
	//   - signals to the customer that we ARE listening (not silent)
	//   - invites them to rephrase, which often shakes the model out
	//     of whatever ambiguity tripped it up
	//   - is logged so the operator can intervene if it keeps happening
	replyText := strings.TrimSpace(out.Text)
	if replyText == "" {
		slog.Warn("ai:reply empty completion, sending fallback",
			"instance", p.InstanceID, "jid", p.RemoteJid,
			"tokens", out.Usage.InputTokens+out.Usage.OutputTokens,
		)
		replyText = "Maaf kak, jawabanku sempat kurang lancar 🙏 Bisa diulang pertanyaannya atau coba kata lain?"
	}

	var usageLogID pgtype.UUID // zero value = null

	outMsg, err := h.Q.CreateOutboundAiMessage(ctx, queries.CreateOutboundAiMessageParams{
		TenantID:     tenantID,
		InstanceID:   instanceID,
		RemoteJid:    p.RemoteJid,
		Body:         pgtype.Text{String: replyText, Valid: true},
		AiUsageLogID: usageLogID,
	})
	if err != nil {
		return fmt.Errorf("ai:reply insert outbound: %w", err)
	}

	if err := h.Q.UpsertWaContactNoPushName(ctx, queries.UpsertWaContactNoPushNameParams{
		TenantID:   tenantID,
		InstanceID: instanceID,
		RemoteJid:  p.RemoteJid,
	}); err != nil {
		slog.Warn("ai:reply upsert contact failed", "err", err)
	}

	// Handoff workflow (JUR-74) — post-reply detection. If the AI's
	// reply contains a handoff phrase, mark the contact and notify
	// admin. Idempotent: if needs_human was already true (raced with
	// another message) we'd skip — but the pre-reply check above
	// already returned in that case, so this branch only fires on the
	// FIRST handoff per session. Group chats (`@g.us`) are skipped
	// entirely per product decision.
	handoffSkippedByGroup := strings.HasSuffix(p.RemoteJid, "@g.us")
	if !handoffSkippedByGroup {
		hr := handoff.Detect(replyText, incomingBody)
		if hr.NeedsHuman {
			if _, err := h.Q.SetWaContactHandoff(ctx, queries.SetWaContactHandoffParams{
				InstanceID:     instanceID,
				RemoteJid:      p.RemoteJid,
				HandoffReason:  pgtype.Text{String: hr.Reason, Valid: true},
				HandoffSummary: pgtype.Text{String: hr.Summary, Valid: true},
			}); err != nil {
				slog.Warn("ai:reply: failed to flag handoff",
					"instance", p.InstanceID, "jid", p.RemoteJid, "err", err)
			} else {
				slog.Info("ai:reply: handoff flagged",
					"instance", p.InstanceID, "jid", p.RemoteJid,
					"reason", hr.Reason)
				// Build a synthetic WaContact for the notifier — saves
				// a re-fetch and the data is already known here.
				ctxContact := contact
				if !ctxContact.NeedsHuman {
					// First-time flag, contact may have been ErrNoRows
					// earlier. Set what we can for the template.
					ctxContact.RemoteJid = p.RemoteJid
				}
				h.dispatchAdminNotification(ctx, instance, ctxContact,
					"Pelanggan butuh bantuan admin", hr.Summary)
			}
		}
	}

	payload, _ := json.Marshal(WASendPayload{MessageID: db.UUIDString(outMsg.ID)})
	task := asynq.NewTask(queue.TaskWASend, payload,
		asynq.Queue(queue.QueueWASend),
		asynq.MaxRetry(2),
	)
	if _, err := h.AsynqClient.EnqueueContext(ctx, task); err != nil {
		return fmt.Errorf("ai:reply enqueue send: %w", err)
	}

	// Promo image follow-up: scan retrieved snippets for any attachment
	// (currently only set by the promotions retriever) whose display
	// name appears in the AI's reply text. For each match, create an
	// outbound image wa_messages row and enqueue wa:send_image so the
	// customer gets the banner right after the text. Failures here are
	// logged-not-fatal — the text reply already shipped.
	imageMatches := matchPromoAttachments(replyText, retrieved)
	imageMatches = append(imageMatches, matchStampCardAttachments(replyText, retrieved)...)
	sentImageKeys := make(map[string]struct{}, len(imageMatches))
	for _, att := range imageMatches {
		if _, dup := sentImageKeys[att.ImageKey]; dup {
			continue
		}
		sentImageKeys[att.ImageKey] = struct{}{}
		mime := mimeFromImageKey(att.ImageKey)
		imgMsg, imgErr := h.Q.CreateOutboundImageMessage(ctx, queries.CreateOutboundImageMessageParams{
			TenantID:       tenantID,
			InstanceID:     instanceID,
			RemoteJid:      p.RemoteJid,
			Body:           pgtype.Text{String: "", Valid: true},
			MediaKey:       pgtype.Text{String: att.ImageKey, Valid: true},
			MediaMime:      pgtype.Text{String: mime, Valid: true},
			MediaSizeBytes: pgtype.Int4{Int32: 0, Valid: false},
		})
		if imgErr != nil {
			slog.Warn("ai:reply: insert promo image row failed",
				"instance", p.InstanceID, "promo", att.Name, "err", imgErr)
			continue
		}
		imgPayload, _ := json.Marshal(WASendPayload{MessageID: db.UUIDString(imgMsg.ID)})
		imgTask := asynq.NewTask(queue.TaskWASendImage, imgPayload,
			asynq.Queue(queue.QueueWASend),
			asynq.MaxRetry(2),
		)
		if _, err := h.AsynqClient.EnqueueContext(ctx, imgTask); err != nil {
			slog.Warn("ai:reply: enqueue promo image task failed",
				"instance", p.InstanceID, "promo", att.Name, "err", err)
			continue
		}
		slog.Info("ai:reply: promo image enqueued",
			"instance", p.InstanceID, "promo", att.Name,
			"msgId", db.UUIDString(imgMsg.ID))
	}

	slog.Info("ai:reply enqueued",
		"instance", p.InstanceID,
		"jid", p.RemoteJid,
		"msgId", db.UUIDString(outMsg.ID),
		"provider", cfg.ProviderType,
		"model", model,
		"tokens", out.Usage.InputTokens+out.Usage.OutputTokens,
		"cost", out.Usage.CostUSD,
		"ragToolsCount", ragToolsCount,
		"snippetsCount", snippetsCount,
		"retrievalMs", retrievalMs,
	)

	return nil
}

// numericToFloat extracts a float64 from a pgtype.Numeric. Returns
// (0, false) when the column is NULL or NaN — caller should treat that
// as "no override, fall back to PriceFor()".
func numericToFloat(n pgtype.Numeric) (float64, bool) {
	if !n.Valid || n.NaN {
		return 0, false
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return 0, false
	}
	return f.Float64, true
}

// dispatchAdminNotification fires the admin alert via the configured
// channels for a handoff event. Currently sends ONE channel — the
// admin WhatsApp message — by enqueueing a wa:send task that the same
// instance will deliver to the configured admin_phone. Skips silently
// when admin_phone is unset OR equals the instance's own number
// (whatsmeow rejects self-sends).
//
// In-app notification + web push are TODOs — see JUR-74 child ticket.
func (h *AIReplyHandler) dispatchAdminNotification(
	ctx context.Context,
	instance queries.WaInstance,
	contact queries.WaContact,
	headline, summary string,
) {
	if !instance.AdminPhone.Valid || instance.AdminPhone.String == "" {
		return // not configured
	}
	adminPhone := instance.AdminPhone.String

	// Self-send guard: whatsmeow rejects messaging the same number that's
	// paired to this instance. Form validation should catch this at save
	// time; defend here too in case the row was set via SQL.
	if instance.PhoneNumber.Valid && normalizeForCompare(instance.PhoneNumber.String) == normalizeForCompare(adminPhone) {
		slog.Warn("handoff: admin_phone == instance phone, skipping notification",
			"instance", db.UUIDString(instance.ID))
		return
	}

	contactName := "Pelanggan"
	if contact.PushName.Valid && contact.PushName.String != "" {
		contactName = contact.PushName.String
	} else if contact.Name.Valid && contact.Name.String != "" {
		contactName = contact.Name.String
	}
	if summary == "" {
		summary = "Lihat di aplikasi untuk detail."
	}

	body := fmt.Sprintf(
		"🔔 *%s*\n\nDari: %s\nRingkasan: %s\n\nBuka di Vintra untuk membalas.",
		headline, contactName, summary,
	)

	// Insert as an outbound wa_messages row so the existing wa:send
	// worker delivers it. Marked ai_generated=true for analytics
	// distinction from operator-typed sends.
	tenantID := instance.TenantID
	// Normalise via the same helper the rest of the send path uses.
	// Without this, an admin_phone like "08118492869" was being
	// concatenated as "08118492869@s.whatsapp.net" — not a valid
	// WhatsApp user → USync stalls and times out 3× before giving up.
	// NormalizeJID converts "08..." → "628..." (Indonesian local → E.164).
	adminJid, err := whatsapp.NormalizeJID(adminPhone)
	if err != nil {
		slog.Warn("handoff: invalid admin_phone, skipping notification",
			"instance", db.UUIDString(instance.ID),
			"adminPhone", adminPhone, "err", err)
		return
	}
	outMsg, err := h.Q.CreateOutboundAiMessage(ctx, queries.CreateOutboundAiMessageParams{
		TenantID:     tenantID,
		InstanceID:   instance.ID,
		RemoteJid:    adminJid,
		Body:         pgtype.Text{String: body, Valid: true},
		AiUsageLogID: pgtype.UUID{}, // null
	})
	if err != nil {
		slog.Warn("handoff: failed to insert admin notification outbound",
			"instance", db.UUIDString(instance.ID), "err", err)
		return
	}
	payload, _ := json.Marshal(WASendPayload{MessageID: db.UUIDString(outMsg.ID)})
	task := asynq.NewTask(queue.TaskWASend, payload,
		asynq.Queue(queue.QueueWASend),
		asynq.MaxRetry(2),
	)
	if _, err := h.AsynqClient.EnqueueContext(ctx, task); err != nil {
		slog.Warn("handoff: failed to enqueue admin notification send",
			"instance", db.UUIDString(instance.ID), "err", err)
	}
}

// matchPromoAttachments scans the AI's reply text for any promo
// attachment whose display name appears as a case-insensitive
// substring. De-duplicates by ImageKey so the same banner isn't
// sent twice if two attachments share the key (currently impossible
// but cheap to defend against). Returns at most one image per
// distinct key.
//
// Match strategy is deliberately simple — substring on lower-cased
// text. False positives are unlikely because promo names are usually
// distinctive ("HEMAT20", "Diskon Lebaran") rather than common words;
// false negatives can happen if the AI rephrases the name (rare in
// practice with the existing prompt). If this proves too loose later,
// upgrade to word-boundary matching.
func matchPromoAttachments(replyText string, snippets []rag.Snippet) []rag.SnippetAttachment {
	if replyText == "" {
		return nil
	}
	lower := strings.ToLower(replyText)
	seen := make(map[string]struct{})
	var out []rag.SnippetAttachment
	for _, s := range snippets {
		for _, att := range s.Attachments {
			if att.ImageKey == "" || att.Name == "" {
				continue
			}
			if _, dup := seen[att.ImageKey]; dup {
				continue
			}
			if strings.Contains(lower, strings.ToLower(att.Name)) {
				out = append(out, att)
				seen[att.ImageKey] = struct{}{}
			}
		}
	}
	return out
}

// matchStampCardAttachments selects pre-rendered loyalty stamp-card
// images to send as a follow-up. Unlike promos (which require the
// program name to appear verbatim), a card is sent when the AI's reply
// talks about stamps at all OR names the program — customers ask "berapa
// stempel saya?" without echoing the program name. Capped at 2 so a
// multi-card customer doesn't get spammed; the loyalty_stamps retriever
// already orders by most progress first.
func matchStampCardAttachments(replyText string, snippets []rag.Snippet) []rag.SnippetAttachment {
	if replyText == "" {
		return nil
	}
	lower := strings.ToLower(replyText)
	mentionsStamp := strings.Contains(lower, "stempel") ||
		strings.Contains(lower, "stamp") ||
		strings.Contains(lower, "kartu")
	seen := make(map[string]struct{})
	var out []rag.SnippetAttachment
	for _, s := range snippets {
		if s.Source != "loyalty_stamps" {
			continue
		}
		for _, att := range s.Attachments {
			if att.ImageKey == "" {
				continue
			}
			if _, dup := seen[att.ImageKey]; dup {
				continue
			}
			if mentionsStamp ||
				(att.Name != "" && strings.Contains(lower, strings.ToLower(att.Name))) {
				out = append(out, att)
				seen[att.ImageKey] = struct{}{}
				if len(out) >= 2 {
					return out
				}
			}
		}
	}
	return out
}

// mimeFromImageKey infers the content type from the S3 key's extension.
// The promo upload helper enforces jpg/png/webp at upload time, so
// these three branches cover every valid promo image. Falls back to
// JPEG so wa:send_image always has *some* mime to record.
func mimeFromImageKey(key string) string {
	switch {
	case strings.HasSuffix(key, ".png"):
		return "image/png"
	case strings.HasSuffix(key, ".webp"):
		return "image/webp"
	default:
		return "image/jpeg"
	}
}

// normalizeForCompare strips +, spaces, dashes for phone-equality check.
// "+62 877-1234" and "62877123" both → "62877123" (just the digits).
func normalizeForCompare(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			out = append(out, s[i])
		}
	}
	return string(out)
}
