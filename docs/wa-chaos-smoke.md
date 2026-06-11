# WhatsApp AI — Production Chaos Smoke Runbook

This runbook is the **final M4 gate** before declaring the WhatsApp AI
backend production-ready. Each scenario verifies one anti-fragility
property of the system. Run on a staging VPS that mirrors prod (NOT
your dev box).

Tracking: [JUR-48](https://linear.app/vintra/issue/JUR-48).

## Pre-flight

- [ ] api binary built from latest `staging` with `appVersion=$(git rev-parse --short HEAD)`
- [ ] Postgres reachable (Supabase pooler), `/readyz` returns 200
- [ ] Redis reachable, AOF enabled, `requirepass` set, `maxmemory` configured
- [ ] PM2 / systemd unit installed for the api binary
- [ ] One real WhatsApp number ready to pair (the "instance" phone)
- [ ] Two more WhatsApp numbers ready: one as the "customer", one as the "admin"
- [ ] Supabase admin AI provider configured with valid DeepSeek key + accurate pricing
- [ ] At least one tenant with `wa_settings.tier='basic'` for the test instance

Each section below is a pass/fail. Capture: log lines that prove the
property held, screenshots if relevant, and any unexpected behavior in
a "Notes" subsection.

---

## 1. Cold deploy

**Goal**: fresh box, no prior state, full pairing flow works.

```bash
# On the staging VPS
sudo systemctl stop vintra-api
sudo rm -rf /var/lib/vintra/data/*       # wipe whatsmeow.db
sudo systemctl start vintra-api
curl -s http://localhost:4000/healthz       # → 200, version matches
curl -s http://localhost:4000/readyz        # → 200, postgres+redis ok, activeInstances=0
```

In the Vintra web UI:

1. Create a new wa_instance "Smoke Test"
2. Click Connect → QR appears
3. Scan from the instance phone
4. Status flips to `connected` within ~5s
5. `curl /readyz` → `activeInstances=1`

**Pass criteria**:
- Both endpoints return 200 within 100ms.
- Instance reaches `connected` without manual intervention.
- `pm2 logs vintra-api` (or `journalctl -u vintra-api`) shows clean event flow, no errors.

---

## 2. AI roundtrip

**Goal**: end-to-end inbound → AI reply → outbound delivery.

In the WA settings:
- Toggle "Auto-Reply AI" on
- Pick the configured DeepSeek provider
- Save a brief system prompt
- Enable Harga Barang + Stok Barang RAG tools

From the customer phone, send: `berapa harga teh?`

**Pass criteria**:
- AI replies within 15 seconds.
- Worker log line includes `provider=openai model=deepseek-v4-flash tokens=... cost=0.000... ragToolsCount=N snippetsCount=N retrievalMs=N`.
- `ai_usage_logs` row inserted with non-zero `cost_usd`.
- Reply text mentions actual product info from the DB (not hallucinated).

---

## 3. Reconnect: airplane mode

**Goal**: transient network drops self-heal, no message duplication.

1. Verify instance is `connected`.
2. Toggle airplane mode on the instance phone for 15 seconds.
3. While disconnected, send 3 messages from the customer phone.
4. Toggle airplane mode off.

**Pass criteria**:
- `wa_instances.status` flips `connected → connecting → connected` within 30s of phone reconnecting.
- All 3 buffered messages eventually arrive in `wa_messages` exactly once (`SELECT external_id, COUNT(*) FROM wa_messages GROUP BY external_id` returns no row with count > 1).
- AI replies to each appropriately (no duplicate replies).
- No tight reconnect loop in logs (interval increases per `scheduleReconnect`).

---

## 4. Reconnect: WhatsApp logout

**Goal**: explicit logout from the WA app doesn't trigger an infinite reconnect storm.

1. On the instance phone, open WhatsApp Settings → Linked Devices → tap the Vintra device → Log out.
2. Watch logs for ~60 seconds.

**Pass criteria**:
- `wa_instances.status` moves to `logged_out`.
- Logs show ONE `LoggedOut` event handled, no further reconnect attempts.
- Re-pairing via QR brings the instance back to `connected`.

---

## 5. SIGTERM mid-send

**Goal**: graceful shutdown drains in-flight work; no message loss.

1. Trigger a burst — from the Vintra UI or a script, enqueue 20 outbound messages to varied JIDs in 2 seconds.
2. Within 1 second of the last enqueue, `sudo systemctl restart vintra-api` (or `pm2 reload`).
3. After restart, watch logs for ~30s and verify all 20 message rows transition to `status='sent'`.

**Pass criteria**:
- Restart completes within 10 seconds (graceful shutdown deadline).
- All 20 `wa_messages` rows reach `status='sent'`.
- No duplicate sends — `external_id` is unique per message.
- `kill -SIGTERM` shutdown logs the intended sequence: HTTP shutdown → asynq drain → registry shutdown.

---

## 6. OOM safety

**Goal**: api memory bounded; whatsmeow socket count understood.

1. Boot api with low `--max-memory-restart` PM2 setting (e.g., 512 MB) OR set systemd `MemoryMax=512M`.
2. Ramp up — register 30+ wa_instances, pair them all, wait for `activeInstances=30` in `/readyz`.
3. Observe RAM in `pm2 monit` or `systemctl status vintra-api`.

**Pass criteria**:
- RAM stays bounded; if max exceeded, supervisor restarts and `Revive()` re-attaches all 30 instances within 60s.
- `safego` (JUR-40) logs no panics during the ramp.
- `/readyz activeInstances` count matches expected after restart.

If RAM grows linearly past safe levels, document the per-instance memory footprint and consider lowering instances-per-VPS in the pricing math (current planning assumes ~50 per 2GB box).

---

## 7. Redis restart

**Goal**: Redis restart doesn't drop instance state or block sends forever.

1. Verify multiple instances connected, AI active.
2. `sudo systemctl restart redis-server` on the api VPS.
3. Observe api behavior for ~60s.
4. Send a customer message during the Redis-down window AND another after recovery.

**Pass criteria**:
- api process doesn't crash. `safego` logs no panics.
- During Redis-down window: AI worker fails the task with retry (asynq buffers in Redis once recovered).
- After Redis recovers: rate-limit buckets reset cleanly, asynq tasks resume processing.
- Instances stay `connected` (whatsmeow's WA socket is independent of Redis).

---

## 8. Rate-limit enforcement (JUR-43 verification)

**Goal**: token bucket actually throttles bursts.

1. From the Vintra UI, enqueue 10 outbound messages to the SAME customer JID rapidly (or via a script POSTing 10 wa_messages).
2. Observe send timing.

**Pass criteria**:
- First message within 1 second.
- Subsequent messages spaced ~1 second apart (matching default `WA_RATE_PER_JID_PER_SEC=1`).
- No HTTP 429 / WhatsApp ban indicators in logs.
- Worker log shows `wa:send rate-limited, requeue` for messages held over MaxWait.

---

## 9. Anti-crash recovery (JUR-40 verification)

**Goal**: synthetic panic in a wrapped goroutine doesn't crash the process.

This requires temporarily injecting a panic. **Do this on a non-prod box only.**

1. Add to `internal/whatsapp/provider.go` `handleWAEvent`:
   ```go
   if rand.Intn(1000) == 0 {
       panic("synthetic chaos panic for JUR-48")
   }
   ```
2. Rebuild + run for ~10 minutes with active inbound traffic.

**Pass criteria**:
- Process stays alive throughout.
- `safego: panic recovered` log lines appear with `label="wa.event_handler"` + stack trace.
- No tenant disconnections.
- Revert the synthetic panic before merging.

---

## 10. Handoff workflow (JUR-74 verification)

**Goal**: AI's handoff promise actually triggers admin notification.

1. Configure the test instance: set `admin_phone` to the second test phone, save.
2. From the customer phone, ask something that triggers handoff (e.g., "saya mau pesan teh original sekarang juga").
3. Observe.

**Pass criteria**:
- AI replies with handoff message.
- `wa_contacts.needs_human=true` for the customer's row.
- The admin phone receives a WhatsApp message with the handoff template.
- Send another message from customer → AI does NOT reply.
- After 24h (or temporarily set `handoff_auto_resume_hours=0` to test), customer's next message → AI auto-resumes + admin gets "AI aktif kembali" alert.

---

## Deviation log

Record anything that didn't match expected behavior here. Each deviation
should turn into a Linear ticket OR be explicitly accepted with rationale.

| # | Scenario | Deviation | Linear ticket / decision |
|---|---|---|---|
| | | | |

## Sign-off

- [ ] Engineer: ___ | Date: ___
- [ ] Product: ___ | Date: ___

When all 10 scenarios pass + deviations resolved, mark JUR-48 Done and
declare M4 complete.
