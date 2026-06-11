# Vintra API — one-time VPS setup

This guide takes a freshly provisioned Ubuntu VPS to "ready to receive
`./deploy.sh api`". Tracks **JUR-58**. Pairs with JUR-46 (the deploy
script) and JUR-47 (Redis config).

Current topology: **same Lightsail VPS as the web app** (`15.232.90.20`).
The Go binary runs on `127.0.0.1:4099`, nginx reverse-proxies
`api.vintra.my.id` → `:4099`.

If you move the api to a separate VPS later, the only changes are:

- Set `API_SERVER_IP` env when running `./deploy.sh api`
- Install Redis on the new box (the api fails fast on missing redis)
- Point `api.vintra.my.id` DNS at the new IP

Everything else (systemd unit, nginx site, .env layout) is identical.

---

## Prerequisites

- Web app already deployed (see `deploy/README.md`)
- `vintra-prod.pem` SSH key present at repo root locally
- DNS for `api.vintra.my.id` ready to be pointed at the VPS

## 1. Install Redis (JUR-47)

Redis runs locally on the same VPS — no remote auth needed beyond
`requirepass` for defense-in-depth.

```bash
ssh -i ./vintra-prod.pem ubuntu@15.232.90.20

sudo apt update
sudo apt install -y redis-server
```

Edit `/etc/redis/redis.conf` — the key changes:

```conf
# Persistence: AOF on, fsync every second (durable, no perceptible
# perf hit at our volume). RDB snapshots disabled — AOF alone is
# enough for asynq queue durability.
appendonly yes
appendfsync everysec
save ""

# Memory cap: 512 MB plus an LRU policy so a runaway producer can't
# OOM the whole box. asynq tasks are tiny; rate-limit + dedupe SETs
# add up to maybe a few MB.
maxmemory 512mb
maxmemory-policy allkeys-lru

# Bind to localhost only — the api connects via 127.0.0.1, no remote
# clients. Default is already 127.0.0.1 but assert it.
bind 127.0.0.1 -::1

# Password — defense-in-depth even on localhost. Generate via:
#   openssl rand -hex 32
requirepass REPLACE_WITH_GENERATED_SECRET
```

Then:

```bash
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# Sanity: should print PONG
redis-cli -a 'REPLACE_WITH_GENERATED_SECRET' PING
```

Remember the password — it goes into the api's `.env` as `REDIS_URL`
in step 4.

## 2. Create the api app directory

```bash
mkdir -p ~/prod/vintra-api/{bin,data}
```

`bin/` will receive the Go binary from `./deploy.sh api`.
`data/` holds the whatsmeow SQLite session files (per-instance).

## 3. Install the systemd unit

From your **local** machine (still in the repo):

```bash
scp -i ./vintra-prod.pem deploy/api/vintra-api.service \
  ubuntu@15.232.90.20:/tmp/vintra-api.service
```

Then on the VPS:

```bash
sudo mv /tmp/vintra-api.service /etc/systemd/system/
sudo systemctl daemon-reload
# Don't `enable --now` yet — the binary doesn't exist + .env doesn't
# exist. We enable after the first deploy.
```

Add the sudoers rule so `deploy.sh` can restart the unit without a
password prompt:

```bash
echo "ubuntu ALL=(ALL) NOPASSWD: /bin/systemctl restart vintra-api, /bin/systemctl status vintra-api, /bin/systemctl is-active vintra-api" | sudo tee /etc/sudoers.d/vintra-api
sudo chmod 0440 /etc/sudoers.d/vintra-api
# Validate — sudo will refuse to start if there's a syntax error
sudo visudo -c
```

## 4. Create the .env file

The systemd unit reads
`/home/ubuntu/prod/vintra-api/.env`. All keys are documented in
`apps/api/.env.example` — copy that as a starting point:

```bash
nano /home/ubuntu/prod/vintra-api/.env
```

Required values:

```
NODE_ENV=production
PORT=4099
LOG_LEVEL=info
APP_URL=https://vintra.my.id

DATABASE_URL=postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxx

REDIS_URL=redis://:GENERATED_PASSWORD@127.0.0.1:6379

OPENAI_API_KEY=sk-xxx     # only if any instance uses OpenAI provider
GEMINI_API_KEY=...        # only if any instance uses Gemini provider

INTERNAL_SERVICE_TOKEN=...  # must match apps/web's .env value

AWS_REGION=ap-southeast-3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=vintra-attendance-photos-pro
```

Tighten perms — the file holds DB creds + AWS keys:

```bash
chmod 600 /home/ubuntu/prod/vintra-api/.env
```

## 5. Issue the SSL cert for api.vintra.my.id

Add a DNS A record `api.vintra.my.id → 15.232.90.20`. Wait for it:

```bash
dig +short api.vintra.my.id A
# Should return 15.232.90.20
```

Then on the VPS:

```bash
sudo certbot --nginx -d api.vintra.my.id
```

Certbot creates a temporary nginx site, validates HTTP-01, and writes
the cert to `/etc/letsencrypt/live/api.vintra.my.id/`.

## 6. Install the real nginx config

From local:

```bash
scp -i ./vintra-prod.pem deploy/nginx/api.vintra.my.id.conf \
  ubuntu@15.232.90.20:/tmp/api.vintra.my.id.conf
```

On the VPS:

```bash
sudo mv /tmp/api.vintra.my.id.conf /etc/nginx/sites-available/api.vintra.my.id
sudo ln -s /etc/nginx/sites-available/api.vintra.my.id /etc/nginx/sites-enabled/
sudo nginx -t                 # validate before reloading
sudo systemctl reload nginx
```

## 7. First deploy

From local:

```bash
./deploy.sh api
```

This:

1. Cross-compiles the Go binary (linux/amd64, CGO disabled).
2. scp's it to `/home/ubuntu/prod/vintra-api/bin/api.new`.
3. Atomically swaps to `bin/api` + `systemctl restart vintra-api`.
4. Probes `/healthz` via ssh to confirm it's up.

Enable the unit so it survives reboots:

```bash
ssh -i ./vintra-prod.pem ubuntu@15.232.90.20 \
  "sudo systemctl enable vintra-api"
```

## 8. Smoke-test from outside

```bash
curl -sS https://api.vintra.my.id/healthz | jq
# {"ok":true,"uptime":"3s","version":"<git-sha>","go":"go1.25.x"}

curl -sS https://api.vintra.my.id/readyz | jq
# Reports postgres + redis status + activeInstances count
```

## 9. Point the web app at the new api host

In `apps/web/.env` on the web VPS:

```
API_URL=https://api.vintra.my.id
```

Then redeploy the web app — `./deploy.sh web` from local.

---

## Troubleshooting

**`Failed to start vintra-api.service: Unit not loaded`** — you copied
the file but forgot `sudo systemctl daemon-reload`.

**`bind: address already in use` in journalctl** — port 4099 is taken
by something else (rare on a fresh VPS; usually a leftover from a
failed earlier run). Check `sudo ss -tlnp | grep :4099`.

**`s3 client unavailable — wa media uploads will be skipped`** — one or
more `AWS_*` env vars in `/home/ubuntu/prod/vintra-api/.env` is
empty. Reread step 4.

**`postgres init failed: failed to connect`** — `DATABASE_URL` is wrong,
or Supabase IP-allowlist blocks the VPS. Supabase pooler in shared
mode should accept any IP; check the connection string.

**`/healthz` works but `/readyz` returns 503** — db or redis is down.
Read the JSON response — it names which dep failed.

**Binary fails to start with `permission denied`** — the deploy chmod'd
it +x but if you're seeing this, the unit's `User=ubuntu` may not own
the file. `sudo chown ubuntu:ubuntu /home/ubuntu/prod/vintra-api/bin/api`.

**`sudo: a password is required` during deploy** — the NOPASSWD rule in
step 3 didn't take. Re-check `/etc/sudoers.d/vintra-api` contents
and run `sudo visudo -c` to validate.
