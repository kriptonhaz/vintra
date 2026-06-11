# WhatsApp AI Backend — Dev Server (ngrok flow)

This guide gets you to a working WhatsApp instance pairing on a fresh laptop in **under 10 minutes**. It's the recommended dev workflow for working on `apps/api` (the NestJS + Baileys service) without provisioning a real VPS.

## Why ngrok?

The api process has **no inbound network requirements from end-user browsers** — Baileys is outbound-only (we connect to WhatsApp's servers; there's no inbound webhook from WA). What does need to reach the api is the **web app's server functions** in `apps/web/src/server/functions/whatsapp.ts`, which forward Supabase JWTs to the api over HTTPS.

When the api is running on your laptop:

- Local web → local api: just `http://localhost:4000`. No ngrok.
- **Prod web → laptop api**: prod can't reach `localhost:4000`. Solution: an ngrok tunnel exposes your laptop on a public HTTPS URL, and the prod web's `API_URL` env var points at that tunnel for the duration of your test.

ngrok is also useful when you want to demo the WA flow from a phone without wiring through your own router.

---

## Prerequisites

- **Bun** ≥ 1.1 — `curl -fsSL https://bun.sh/install | bash`
- **Docker Desktop** (or Docker Engine on Linux) — for the local Redis container
- **ngrok** account (free tier is fine — one tunnel, no concurrent limit issue for solo dev)
- The repo cloned with `apps/api/.env` populated (copy from `apps/api/.env.example`, fill in `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`/`GEMINI_API_KEY` as needed)

---

## 1. Install ngrok

```bash
# macOS
brew install ngrok

# or download the binary from ngrok.com/downloads
```

Then auth your ngrok client (one-time):

```bash
ngrok config add-authtoken <your-token-from-ngrok-dashboard>
```

## 2. Start the local api stack

In one terminal — Redis + the api process:

```bash
# Redis with AOF on (Baileys creds survive restart)
docker compose up -d redis

# api process — port 4000, hot reload via --watch
cd apps/api && bun --watch src/main.ts
```

You should see Nest log every module initialise and `[api] listening on http://0.0.0.0:4000/v1`.

Sanity check (in another terminal):

```bash
curl -i http://localhost:4000/v1/anything
# expect: HTTP/1.1 401 Unauthorized   ← auth guard active
```

## 3. Expose the api via ngrok

In a second terminal:

```bash
ngrok http 4000
```

ngrok prints a forwarding URL like `https://abc123.ngrok-free.app`. Copy it.

Verify the tunnel reaches your api:

```bash
curl -i https://abc123.ngrok-free.app/v1/anything
# expect: HTTP/1.1 401 Unauthorized   ← same as before, but via the tunnel
```

## 4. Point web at the tunnel

### Option A — local web dev (most common)

Edit `apps/web/.env`:

```
API_URL=https://abc123.ngrok-free.app
```

Restart the web dev server:

```bash
bun run dev
```

The local web at `http://localhost:3000` now talks to your laptop api over the public ngrok URL. (Yes, this routes localhost → ngrok cloud → back to localhost. It works because that's exactly what we'd test in prod later.)

### Option B — prod web pointing at your laptop (only when you need to verify a fix end-to-end against real prod data)

**Read this whole section before doing it.** This is a temporary debugging tool, not a steady state.

```bash
ssh ubuntu@<web-vps-ip>
# In the web app's .env on the prod box:
echo "API_URL=https://abc123.ngrok-free.app" >> /home/ubuntu/prod/Vintra/.env
pm2 restart vintra-web --update-env
```

When you're done:

```bash
# Remove the line you just added (or set it back to the real api URL).
pm2 restart vintra-web --update-env
```

### ⚠️ Safety rules for Option B

1. **Never leave prod pointed at a personal dev tunnel.** If you close your laptop / drop wifi / kill the api process, every WhatsApp action in prod will hard-fail until someone notices. Set a 30-minute timer when you start, and revert when it goes off.
2. **Don't share the ngrok URL.** Anyone who gets it can hammer your laptop api with auth-rejected requests. Free-tier ngrok URLs are guessable enough; treat them as semi-private.
3. **Local Redis loses any sessions you create during the test.** If you pair a real WhatsApp number against your laptop api, those creds are in your local Redis only — they won't transfer when prod points back at the real api. Tear down anything you don't want to recover.

---

## Auth flow recap

```
Browser  ──→  vintra.my.id (web)
                │  reads sb-access-token cookie
                ▼
              web's server function (apps/web/src/server/functions/whatsapp.ts)
                │  forwards JWT as `Authorization: Bearer ...`
                ▼
              https://abc123.ngrok-free.app/v1/wa/...   (ngrok)
                ▼
              ThinkPad: bun src/main.ts  (api)
                │  SupabaseJwtGuard verifies via supabase.auth.getUser()
                ▼
              200 / 401 / 403 → back up the chain
```

Key invariants:

- The browser **never talks to the api directly**. Every call goes through web's server functions, which is why **CORS isn't configured** on the api.
- Both web and api verify against the **same Supabase project**, so the same JWT is valid on both sides regardless of where each runs.
- No cookies are shared cross-origin. The Supabase token travels in an `Authorization` header server-to-server.

See `apps/web/src/server/functions/whatsapp.ts:15-34` for the JWT-forwarding helper and `apps/api/src/auth/supabase-jwt.guard.ts` for the verification side.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ECONNREFUSED localhost:4000` from web | api isn't running | `cd apps/api && bun --watch src/main.ts` |
| All web → api calls return 401 even when logged in | web is calling the wrong host | Confirm `API_URL` in `apps/web/.env` matches your ngrok URL exactly (no trailing slash) |
| QR scan succeeds but instance flips to `disconnected` immediately | Redis isn't running OR isn't persistent | `docker compose ps redis` should show "Up"; `docker exec vintra-redis redis-cli CONFIG GET appendonly` should return `yes` |
| `Error: Queue name cannot contain :` on api boot | You're on a stale checkout pre-fix `78fe288` | `git pull` |
| ngrok tunnel returns 502 | api process crashed | `bun --watch` should have restarted it; check the terminal for the stack trace |
| api boots but `[Nest] ... ERROR` about Redis | `REDIS_URL` in `apps/api/.env` doesn't match local Redis | Default for docker-compose is `redis://127.0.0.1:6379` (no auth) |

---

## When ngrok is overkill

If you're just iterating on web ↔ api locally and don't need prod to reach you, **skip ngrok entirely**:

```
apps/web/.env:    API_URL=http://localhost:4000
apps/api/.env:    REDIS_URL=redis://127.0.0.1:6379
```

Run web (`bun run dev`) and api (`cd apps/api && bun --watch src/main.ts`) side by side. The full WhatsApp pairing + auto-reply flow works without ever leaving your laptop.

ngrok is only needed when **another machine** (prod web, a colleague's laptop, a phone on cellular data without your wifi) has to reach your api.
