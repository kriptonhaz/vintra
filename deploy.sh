#!/usr/bin/env bash
# Deploy Vintra apps to their VPS targets.
#
# Two apps live on the SAME Lightsail VPS today (JUR-46/JUR-58):
#   - web: Node + PM2 (TanStack Start SSR)        port 3000 behind nginx
#   - api: Go binary + systemd (Fiber + whatsmeow) port 4000 behind nginx
#
# They share the box but are deployed independently, with different
# build pipelines and different process supervisors.
#
# Usage:
#   ./deploy.sh              # → web (legacy default — no regression)
#   ./deploy.sh web          # → web (explicit)
#   ./deploy.sh api          # → api (Go binary)
#
# Per-target config (env vars override defaults):
#   WEB_SERVER_IP    default: 15.232.90.20           (prod web — Jakarta Lightsail)
#   WEB_REMOTE_DIR   default: /home/ubuntu/prod/Vintra
#   WEB_SSH_KEY      default: ./vintra-prod.pem
#   (WEB_PM2_APP no longer used — web runs two PM2 apps,
#    vintra-web-a + vintra-web-b, both defined in
#    ecosystem.config.cjs and managed by remote_install_and_restart.)
#
#   API_SERVER_IP    default: same as WEB_SERVER_IP  (single-VPS topology)
#   API_REMOTE_DIR   default: /home/ubuntu/prod/vintra-api
#   API_SERVICE      default: vintra-api          (systemd unit name)
#   API_SSH_KEY      default: ./vintra-prod.pem
#
#   SERVER_USER      default: ubuntu                 (shared)
#
# Examples:
#   ./deploy.sh web
#   ./deploy.sh api
#   API_SERVER_IP=1.2.3.4 ./deploy.sh api          # separate api VPS (future)
set -euo pipefail

TARGET="${1:-web}"
SERVER_USER="${SERVER_USER:-ubuntu}"

case "$TARGET" in
  web)
    SERVER_IP="${WEB_SERVER_IP:-15.232.90.20}"
    REMOTE_DIR="${WEB_REMOTE_DIR:-/home/ubuntu/prod/Vintra}"
    SSH_KEY="${WEB_SSH_KEY:-./vintra-prod.pem}"
    ;;
  api)
    # Default to the SAME box as web — current single-VPS topology
    # documented in deploy/README.md. Override API_SERVER_IP if/when
    # the api gets its own host.
    SERVER_IP="${API_SERVER_IP:-${WEB_SERVER_IP:-15.232.90.20}}"
    REMOTE_DIR="${API_REMOTE_DIR:-/home/ubuntu/prod/vintra-api}"
    API_SERVICE="${API_SERVICE:-vintra-api}"
    SSH_KEY="${API_SSH_KEY:-./vintra-prod.pem}"
    ;;
  *)
    echo "✗ Unknown target: $TARGET" >&2
    echo "  Usage: ./deploy.sh [web|api]" >&2
    exit 1
    ;;
esac

SERVER="${SERVER_USER}@${SERVER_IP}"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ServerAliveInterval=15"

# ── Sanity checks ──────────────────────────────────────────────────
if [ ! -f "$SSH_KEY" ]; then
  echo "✗ SSH key not found at $SSH_KEY" >&2
  exit 1
fi
chmod 600 "$SSH_KEY"   # ssh refuses overly-permissive keys

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# ── Helpers ────────────────────────────────────────────────────────

remote_install_and_restart() {
  # Single remote-shell helper used by deploy_web.
  #
  # Web runs TWO PM2 fork apps (vintra-web-a on :3000,
  # vintra-web-b on :3001) fronted by an nginx upstream block.
  # Deploys restart them sequentially with a health-check wait
  # between — when -a is down, nginx routes to -b, and vice versa.
  # End result: zero connection drops, no Cloudflare 520 during
  # deploys.
  #
  # Uses heredoc so the literal $REMOTE_DIR from the outer scope is
  # expanded BEFORE the heredoc is sent (note the unquoted EOF).
  # Variables that should evaluate on the REMOTE shell are escaped
  # with backslashes (\$VAR, \$(cmd)).
  echo "→ Installing prod deps + rolling restart of PM2 web apps..."
  ssh $SSH_OPTS "$SERVER" bash <<EOF
    set -e
    # Non-interactive ssh skips ~/.bashrc, so nvm (where node + pm2
    # live on the web box) isn't loaded by default. Source it
    # explicitly + add bun to PATH.
    export NVM_DIR="\$HOME/.nvm"
    [ -s "\$NVM_DIR/nvm.sh" ] && . "\$NVM_DIR/nvm.sh"
    export PATH="\$HOME/.bun/bin:\$PATH"
    command -v bun >/dev/null || { echo "✗ bun not found on server PATH"; exit 1; }
    command -v pm2 >/dev/null || { echo "✗ pm2 not found — try: bun install -g pm2"; exit 1; }
    cd "$REMOTE_DIR"
    # Clean stale node_modules before each install. Without this,
    # workspace dep reshuffles (e.g. adding apps/mobile bumped React
    # to root-only hoisting) leave the OLD nested copies in place,
    # which then collide with the new ones at runtime — see the May
    # 2026 SSR outage when two React 19 copies broke the hook
    # dispatcher. ~5s overhead per deploy, prevents a whole class of
    # "works on my install, breaks on yours" mismatches.
    rm -rf node_modules apps/*/node_modules packages/*/node_modules
    bun install --production

    # Restart helper: kicks an app and polls its port until 200 OK
    # before returning. 15s timeout = enough for a cold-start +
    # warmup (typical startup is ~5s). Failing here exits the whole
    # script so we don't restart the second instance before the
    # first one's confirmed healthy — that would mean both down.
    restart_one() {
      local app="\$1"
      local port="\$2"
      echo "→ Restarting \$app (port \$port)..."
      pm2 restart "\$app" --update-env
      for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
        if curl -sf -m 2 "http://127.0.0.1:\$port/" > /dev/null 2>&1; then
          echo "  ✓ \$app ready on :\$port (after \${i}s)"
          return 0
        fi
        sleep 1
      done
      echo "  ✗ \$app failed to respond on :\$port within 15s"
      pm2 logs "\$app" --lines 30 --nostream 2>&1 | tail -40
      return 1
    }

    # Three-way state machine:
    #   1. Both -a and -b exist (steady state) → rolling restart
    #   2. Only legacy vintra-web exists → fall through to first-time
    #      branch which deletes it + starts both fresh
    #   3. Nothing exists → first-time start of both
    if pm2 describe vintra-web-a > /dev/null 2>&1 && pm2 describe vintra-web-b > /dev/null 2>&1; then
      restart_one vintra-web-a 3000
      restart_one vintra-web-b 3001
    else
      # Either first deploy on this box, OR transitional cutover
      # from the legacy single-app setup. In both cases: nuke any
      # stale vintra-web* entries and start the new ecosystem
      # fresh. There's a few-second window here where the site is
      # down — only happens once per box.
      echo "→ First-time or post-cutover start — recreating PM2 apps"
      pm2 delete vintra-web > /dev/null 2>&1 || true
      pm2 delete vintra-web-a > /dev/null 2>&1 || true
      pm2 delete vintra-web-b > /dev/null 2>&1 || true
      pm2 start ecosystem.config.cjs
      pm2 save
    fi
    pm2 status
EOF
}

deploy_web() {
  echo "→ Building web locally..."
  bun run build

  if [ ! -d "apps/web/dist/server" ] || [ ! -d "apps/web/dist/client" ]; then
    echo "✗ Build output missing — apps/web/dist/{server,client}" >&2
    exit 1
  fi

  ssh $SSH_OPTS "$SERVER" \
    "mkdir -p $REMOTE_DIR/apps/web/dist $REMOTE_DIR/apps/mobile $REMOTE_DIR/packages/db $REMOTE_DIR/packages/shared"

  echo "→ Syncing web build output (apps/web/dist/)..."
  rsync -avz --delete -e "ssh $SSH_OPTS" \
    apps/web/dist/ \
    "$SERVER:$REMOTE_DIR/apps/web/dist/"

  echo "→ Syncing server entry + workspace package metadata..."
  rsync -avz -e "ssh $SSH_OPTS" \
    apps/web/server-entry.mjs \
    apps/web/package.json \
    "$SERVER:$REMOTE_DIR/apps/web/"

  rsync -avz -e "ssh $SSH_OPTS" \
    package.json \
    bun.lock \
    bunfig.toml \
    ecosystem.config.cjs \
    "$SERVER:$REMOTE_DIR/"

  rsync -avz -e "ssh $SSH_OPTS" \
    packages/db/package.json \
    "$SERVER:$REMOTE_DIR/packages/db/"

  rsync -avz -e "ssh $SSH_OPTS" \
    packages/shared/package.json \
    "$SERVER:$REMOTE_DIR/packages/shared/"

  # Mobile workspace must exist on the server even though we don't run
  # it there — the root `apps/*` workspace glob in package.json + the
  # lockfile both reference apps/mobile, so `bun install --production`
  # errors with "lockfile had changes" without this stub. Just the
  # package.json is enough; bun installs zero deps for it (we don't
  # call `bun run --filter @vintra/mobile <anything>` on the server).
  rsync -avz -e "ssh $SSH_OPTS" \
    apps/mobile/package.json \
    "$SERVER:$REMOTE_DIR/apps/mobile/"

  remote_install_and_restart
}

deploy_api() {
  # Go single-binary deploy. Cross-compile locally so the prod box
  # never needs the Go toolchain — keeps the VPS surface area tiny
  # and lets us deploy from any machine with Go installed.
  #
  # CGO_ENABLED=0 produces a fully-static binary; modernc.org/sqlite
  # is pure-Go so it works without cgo. ldflags injects the git SHA
  # into appVersion so /healthz reflects what's actually running.
  local short_sha
  short_sha="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo dev)"
  local bin_local="apps/api/bin/api"

  echo "→ Building api binary locally (linux/amd64, version=$short_sha)..."
  (
    cd "$REPO_ROOT/apps/api"
    mkdir -p bin
    GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
      go build -trimpath -ldflags "-s -w -X main.appVersion=$short_sha" \
      -o bin/api ./cmd/api
  )

  if [ ! -f "$REPO_ROOT/$bin_local" ]; then
    echo "✗ Build output missing — $bin_local" >&2
    exit 1
  fi

  echo "→ Preparing remote directory at $REMOTE_DIR..."
  ssh $SSH_OPTS "$SERVER" \
    "mkdir -p '$REMOTE_DIR/bin' '$REMOTE_DIR/data'"

  echo "→ Uploading binary (~$(du -h "$bin_local" | awk '{print $1}'))..."
  # Upload to .new first, then atomically swap. systemd's restart
  # picks up the new file; no race because the old process is still
  # holding its file descriptor (Linux semantics).
  rsync -avz --progress -e "ssh $SSH_OPTS" \
    "$bin_local" "$SERVER:$REMOTE_DIR/bin/api.new"

  echo "→ Swap + restart $API_SERVICE..."
  ssh $SSH_OPTS "$SERVER" bash <<EOF
    set -e
    cd "$REMOTE_DIR"
    chmod +x bin/api.new
    mv bin/api.new bin/api
    # systemctl restart needs sudo. Configure NOPASSWD for this
    # specific unit in /etc/sudoers.d/vintra-api (see JUR-58).
    sudo systemctl restart $API_SERVICE
    # Wait briefly then assert it's still running — catches crashes
    # on startup (bad env, port collision, etc.) before we declare
    # success.
    sleep 2
    if ! systemctl is-active --quiet $API_SERVICE; then
      echo "✗ $API_SERVICE failed to start — check 'journalctl -u $API_SERVICE -n 50'" >&2
      exit 1
    fi
    systemctl status $API_SERVICE --no-pager -n 5
EOF

  echo "→ Probing /healthz..."
  # If api binds to localhost only (recommended — nginx fronts it),
  # we curl via ssh. Port matches the default in apps/api/.env.example.
  ssh $SSH_OPTS "$SERVER" \
    "curl -fsS http://127.0.0.1:4099/healthz | head -c 200 ; echo" || {
    echo "✗ /healthz failed — service is up but not responding cleanly" >&2
    exit 1
  }
}

case "$TARGET" in
  web) deploy_web ;;
  api) deploy_api ;;
esac

echo "✓ Deployed $TARGET to $SERVER_IP"
