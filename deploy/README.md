# Vintra — production deployment

Both apps live on the **same Lightsail VPS** in Jakarta. They're deployed
independently with different supervisors:

```
                 Browser
                    │ HTTPS
        ┌───────────┴───────────┐
        ▼                       ▼
   vintra.my.id         api.vintra.my.id
        │                       │
  Nginx (port 443)         Nginx (port 443)
        │ proxy_pass            │ proxy_pass
        ▼ 127.0.0.1:3000        ▼ 127.0.0.1:4099
   Node + PM2              Go binary + systemd
   (apps/web)              (apps/api)
        │                       │
        ├─── Supabase (DB + Auth)
        ├─── AWS S3 (media)
        ├─── Redis 6 (api only — sessions, queues, rate-limit)
        └─── DeepSeek / OpenAI / Gemini (ai providers)
```

| | Web (apps/web) | API (apps/api) |
|---|---|---|
| **URL** | https://vintra.my.id | https://api.vintra.my.id |
| **Runtime** | Node 22 (TanStack Start SSR) | Go static binary (Fiber + whatsmeow) |
| **Supervisor** | PM2 (`vintra-web-a` + `vintra-web-b`) | systemd (`vintra-api`) |
| **Port** | 3000 (behind nginx) | 4099 (behind nginx) |
| **Build location** | Local — `bun run build` then rsync `dist/` | Local — `go build` cross-compile to linux/amd64 then rsync binary |
| **Deps install on server** | `bun install --production` | None — static binary |
| **Repo path on server** | `~/prod/Vintra` → symlink to the live release under `~/prod/Vintra-releases/` | `~/prod/vintra-api` |
| **.env path on server** | `~/prod/Vintra/.env` → `~/prod/Vintra-shared/.env` (Node `--env-file`) | `~/prod/vintra-api/.env` (systemd `EnvironmentFile=`) |

**VPS:** `ubuntu@15.232.90.20` (Lightsail, region ap-southeast-3 / Jakarta)

---

## Quick deploy

From your local machine, at the repo root:

```bash
./deploy.sh web      # build TanStack Start + rsync + pm2 reload   (~30s)
./deploy.sh api      # cross-compile Go binary + rsync + systemctl restart   (~10s)
./deploy.sh          # → same as `web` (legacy default)
```

Each command is independent — deploy one without touching the other.

### What `./deploy.sh web` does

Web is deployed as **immutable releases behind a symlink**, never by
overwriting the live tree:

```
~/prod/Vintra-releases/<utc>-<sha>/    one full app tree per deploy
~/prod/Vintra          -> symlink to the live release
~/prod/Vintra-shared/.env              survives every release
```

1. `bun run build` locally → `apps/web/dist/{client,server}`
2. rsync `apps/web/dist/`, `server-entry.mjs`, workspace `package.json`s,
   `bun.lock`, `bunfig.toml`, `ecosystem.config.cjs` into a **fresh**
   release directory
3. SSH → `bun install --production` inside that release
4. Atomic cutover: `ln -sfn` + `mv -T` swaps `~/prod/Vintra` in one
   `rename()` syscall
5. Rolling restart `vintra-web-a` → `vintra-web-b`, health-checking each.
   A failed check rolls the symlink back and restarts
6. Prune old releases, keeping the last 3 for rollback

**Why releases instead of syncing in place.** The build splits routes into
hash-named chunks the server imports lazily. Overwriting the live tree while
the old processes are still serving deletes chunks they have not imported
yet, and the next request for that route dies with `ERR_MODULE_NOT_FOUND`;
wiping `node_modules` mid-flight does the same to any dependency not yet
required. Both hit JuraganQu in production on 2026-08-17 — a ~20-second
window per deploy. Node resolves module paths to their realpath, so a
process started before the swap keeps loading from its own release for its
whole life and only sees new code when it is restarted.

**`.env` is unchanged in practice.** It lives in `~/prod/Vintra-shared/` and
is symlinked into every release, so editing `~/prod/Vintra/.env` still lands
on the same file and now survives deploys. The first deploy copies the
existing file there automatically.

### What `./deploy.sh api` does

1. `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags '-s -w -X main.appVersion=<git-sha>'` locally → ~27 MB static binary
2. rsync to `~/prod/vintra-api/bin/api.new`
3. SSH → atomic swap to `bin/api` → `sudo systemctl restart vintra-api`
4. Probe `127.0.0.1:4099/healthz` via SSH — fails the deploy if it doesn't return 200

The api binary contains **only code** — secrets and config come from
`~/prod/vintra-api/.env` (loaded by systemd at start). Same compiled
binary works in dev / staging / prod; environments differ only by `.env`.

### Override defaults via env

```bash
WEB_SERVER_IP=1.2.3.4 ./deploy.sh web
API_SERVER_IP=1.2.3.4 ./deploy.sh api          # when api moves to its own VPS
```

Full list of overrides in `deploy.sh` header comments.

---

## First-time setup

### Web (one-time per fresh VPS)

Run [the steps below in this README](#web--first-time-server-setup) — install Node + nginx + certbot + PM2, drop the nginx config, point DNS, issue SSL, harden firewall, persist PM2.

### API (one-time per fresh VPS)

See **[`deploy/api/README.md`](./api/README.md)** for the full checklist:

- Install Redis with AOF + `requirepass` + `maxmemory` (JUR-47)
- Create `~/prod/vintra-api/{bin,data}`
- Install the systemd unit + sudoers NOPASSWD rule
- Create `~/prod/vintra-api/.env` from your secrets
- DNS A record `api.vintra.my.id → <VPS IP>`
- Certbot for `api.vintra.my.id`
- Install nginx vhost from `deploy/nginx/api.vintra.my.id.conf`
- First `./deploy.sh api`
- Set `API_URL=https://api.vintra.my.id` in the **web** `.env` + redeploy web

---

## Web — first-time server setup

Only needed once per fresh VPS.

### 1. Install runtime + tools

```bash
# Node (via nvm) + npm-globals (pm2)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22 && nvm alias default 22

# Bun (for workspace install on the server)
curl -fsSL https://bun.sh/install | bash

# Nginx + certbot
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

# PM2 (global, via npm from nvm node)
npm i -g pm2
```

### 2. Fix home directory permissions

**Important** — Lightsail's default `/home/ubuntu` mode is `0750`, which
blocks nginx (running as `www-data`) from reading static files inside it.
Relax it so nginx can traverse in:

```bash
sudo chmod 0755 /home/ubuntu
```

Without this, every `/assets/*.css` request will 404 with
`(13: Permission denied)` in the nginx error log.

### 3. Clone the repo

```bash
mkdir -p ~/prod && cd ~/prod
git clone git@github.com:kriptonhaz/vintra.git
cd Vintra && bun install
```

### 4. Create the env file

Create `~/prod/Vintra/.env` (**repo root** — PM2 loads it via Node's
`--env-file` flag, see `ecosystem.config.cjs`):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
DATABASE_URL=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=ap-southeast-3
AWS_S3_BUCKET=vintra-attendance-photos-pro
ATTENDANCE_QR_SECRET=...
INTERNAL_SERVICE_TOKEN=...
VITE_APP_URL=https://vintra.my.id
# When the api is deployed (after JUR-46), point at it:
API_URL=https://api.vintra.my.id
```

> Env goes at the **repo root**, not `apps/web/.env`. Node 20+'s `--env-file`
> flag reads it at process startup before any imports run — so server-side
> clients (Supabase, postgres, AWS SDK) can read `process.env.X` at module
> load time without needing a `dotenv` dependency.

### 5. Install the nginx config

The committed `deploy/nginx/vintra.conf` is HTTP-only. Certbot will
modify it in place to add SSL + the HTTPS redirect on first run.

```bash
sudo cp deploy/nginx/vintra.conf /etc/nginx/sites-available/vintra
sudo ln -s /etc/nginx/sites-available/vintra /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t                     # validate
sudo systemctl reload nginx
```

### 6. First deploy (so nginx has files to serve)

Before issuing SSL certs, get the app running over HTTP:

```bash
# From your LOCAL machine, not the server:
./deploy.sh web
```

Verify on the server:

```bash
curl -I http://127.0.0.1/               # 200 OK from nginx → Node
curl -I http://127.0.0.1/assets/app-*.css   # 200 OK + text/css
```

### 7. Point the domain at the VPS

In your DNS registrar, add:

| Type | Name | Value |
|---|---|---|
| A | `@` | `15.232.90.20` |
| A | `www` | `15.232.90.20` |
| A | `api` | `15.232.90.20`  ← for the api (added during api setup) |

Wait for propagation (`dig +short vintra.my.id A` should return the IP).

### 8. Issue SSL certs

```bash
sudo certbot --nginx \
  -d vintra.my.id -d www.vintra.my.id \
  --non-interactive --agree-tos \
  --email <your-email> \
  --redirect
```

Auto-renewal runs daily via `certbot.timer`. Verify with
`sudo certbot renew --dry-run`.

### 9. Harden the firewall

Open ports 22, 80, 443 in the Lightsail console networking tab, then on the server:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status
```

### 10. Persist PM2 across reboots

```bash
pm2 startup          # prints a `sudo ...` command — copy-paste and run it
pm2 save
```

After this, PM2 resumes `vintra-web` automatically if the VPS reboots.

---

## Useful commands on the server

### Web (PM2)

| Command | What |
|---|---|
| `pm2 status` | List running apps |
| `pm2 logs vintra-web --lines 100` | Last 100 log lines |
| `pm2 restart vintra-web --update-env` | Restart after `.env` change |
| `pm2 monit` | Live CPU / memory dashboard |

### API (systemd)

| Command | What |
|---|---|
| `sudo systemctl status vintra-api` | Service state + last few log lines |
| `sudo journalctl -u vintra-api -f` | Tail api logs (Ctrl+C to exit) |
| `sudo journalctl -u vintra-api -n 200` | Last 200 lines |
| `sudo systemctl restart vintra-api` | Restart (needed after `.env` change) |
| `curl http://127.0.0.1:4099/healthz` | Local health probe |
| `curl http://127.0.0.1:4099/readyz` | Postgres + Redis + activeInstances check |

### Shared infra

| Command | What |
|---|---|
| `sudo nginx -t` | Validate nginx config |
| `sudo systemctl reload nginx` | Reload nginx after config edit |
| `sudo tail -f /var/log/nginx/error.log` | Tail nginx error log |
| `redis-cli -a <pass> ping` | Verify Redis (api stack) |
| `sudo certbot renew --dry-run` | Verify SSL renewal works |

---

## Troubleshooting

### `pm2 ls` shows nothing after running `./deploy.sh web`

**Cause:** `node` / `pm2` aren't on the non-interactive SSH PATH. nvm loads
via `~/.bashrc`, which non-interactive SSH skips.

**Fix:** Already handled by `deploy.sh` — it explicitly sources nvm in its
SSH heredoc. If you see `pm2: command not found` in the deploy output,
either nvm isn't installed (web step 1) or the default node alias is
missing (`nvm alias default 22`).

### Browser loads HTML but no CSS/JS (unstyled page)

Nginx is either not installed/running, or its config doesn't have the
static-asset location blocks. Check which config is live:

```bash
sudo cat /etc/nginx/sites-enabled/vintra
```

If it's missing the `location ~* ^/(_build|assets|images|fonts)/` block,
re-install the config (see step 5).

> ⚠️ If the server has already gone through certbot, the live config has
> SSL blocks the repo copy doesn't. Either re-run certbot after the
> overwrite, or pull the certbot-modified config back into the repo first.

### `/assets/*.css` returns 404 with `(13: Permission denied)` in error log

**Cause:** `/home/ubuntu` has mode `0750` (Lightsail default); `www-data`
can't traverse it.

**Fix:** `sudo chmod 0755 /home/ubuntu` (web setup step 2).

### `./deploy.sh api` fails with "sudo: a password is required"

The sudoers NOPASSWD rule for `vintra-api` isn't installed. Re-run the
sudoers step in [`deploy/api/README.md`](./api/README.md#3-install-the-systemd-unit).

### `./deploy.sh api` succeeds but `/healthz` returns 502 via nginx

API binary is running but nginx is proxying to the wrong port. The api
listens on `:4099` (set in `apps/api/.env.example` + the prod `.env`); the
nginx config at `deploy/nginx/api.vintra.my.id.conf` must match.

Check: `sudo grep proxy_pass /etc/nginx/sites-enabled/api.vintra.my.id`
should show `127.0.0.1:4099`.

### API starts but `/readyz` returns 503

The response JSON names which dependency failed. Most common:

- `"postgres":"error"` — `DATABASE_URL` is wrong in `~/prod/vintra-api/.env`,
  or Supabase pooler is down
- `"redis":"error"` — Redis password mismatch (the prod `REDIS_URL` must
  include the same password as `/etc/redis/redis.conf requirepass`)

### Deploy fails with "rsync: mkdir ... failed: No such file or directory"

**Web:** `REMOTE_DIR` in `deploy.sh` doesn't match where the repo is
cloned on the server. Default is `/home/ubuntu/prod/Vintra`.

**API:** `~/prod/vintra-api` was never created — re-run step 2 of
[`deploy/api/README.md`](./api/README.md#2-create-the-api-app-directory).

### Node starts but crashes with "Missing Supabase env var"

**Cause:** `.env` isn't at the expected location. PM2 loads it from the
**repo root** (`~/prod/Vintra/.env`), not `apps/web/.env`.

**Fix:** Check `ecosystem.config.cjs` — the `interpreter_args` field should
include `--env-file=../../.env` (relative to `cwd: './apps/web'`).

### Certbot fails: "Challenge failed for domain"

Certbot answers Let's Encrypt's HTTP-01 challenge via nginx on port 80.
For this to work:
- DNS must already be pointing at the VPS
- Port 80 must be open in Lightsail + UFW
- Nginx must be running and serving the domain

Check `sudo tail /var/log/letsencrypt/letsencrypt.log` for the specific
error.

---

## Architecture notes

- **Build runs locally** for both apps, not on the VPS. Lightsail's
  smallest instance (512 MB RAM) doesn't have enough memory for a Vite
  production build. The Go cross-compile produces a static binary so the
  VPS doesn't need a Go toolchain at all.
- **Single VPS for both apps** — current scale doesn't warrant
  separation. To split: provision a second VPS, set `API_SERVER_IP=<new ip>`
  on `./deploy.sh api`, point `api.vintra.my.id` DNS at the new box.
  Everything else (systemd unit, nginx config, `.env` layout) is identical.
- **nginx serves web static assets directly** from `dist/client/`. Only
  SSR routes hit Node. The api has no static assets — every request goes
  through Fiber.
- **PM2 single fork mode** for web — no clustering. The api is a single
  process too; whatsmeow is stateful per WhatsApp instance.
- **Env loaded by Node's `--env-file`** (Node 20+) for web; by systemd's
  `EnvironmentFile=` for api. Both before any imports run — every server
  module sees the vars on first access.
- **Workspace packages** (`@vintra/db`, `@vintra/shared`) are inlined
  into the SSR bundle by Vite. Only `apps/web/package.json` runtime deps
  need `bun install` on the server. The Go binary has zero runtime deps.
