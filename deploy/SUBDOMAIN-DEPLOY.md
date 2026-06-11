# Subdomain deploy runbook — JUR-185

One-time setup to enable `<slug>.vintra.my.id` for tenant public pages. Estimated time: **30–45 minutes** end-to-end (plus ~24h DNS propagation window if migrating DNS to Cloudflare for the first time).

You'll do this **in parallel** with my code work — they meet at the deploy step. Nothing in this runbook depends on the code being ready; you can do all of this before I'm done and the existing site keeps working unaffected.

---

## Phase 1: DNS migration to Cloudflare (one-time)

### 1.1 Sign up Cloudflare (free)

1. Go to https://dash.cloudflare.com/sign-up
2. Create an account with your email
3. Skip any paid-plan upsells — the free tier is sufficient

### 1.2 Add vintra.my.id as a Cloudflare site

1. Click **Add a Site** in the dashboard
2. Enter `vintra.my.id`
3. Pick the **Free** plan
4. Cloudflare automatically scans Hostinger's DNS records and copies them — wait for the scan to finish (~15 seconds)
5. **Important verification step**: scroll through the imported records. Compare against your Hostinger DNS panel (Hostinger → Domains → vintra.my.id → DNS / Nameservers). Anything in Hostinger but missing from Cloudflare → add manually before proceeding. Likely candidates if you've ever set them: MX records (for email), SPF/DKIM TXT records, any custom subdomain A records.

### 1.3 Flip nameservers at Hostinger

Cloudflare gives you 2 nameservers like `marc.ns.cloudflare.com` + `sara.ns.cloudflare.com` (your specific names will differ).

1. In Hostinger: **Domains** → click `vintra.my.id` → **Nameservers**
2. Select **Use custom nameservers**
3. Paste the 2 Cloudflare nameservers
4. Save

Propagation timer starts. Usually finishes within 1 hour, max 24h. **Existing site keeps working throughout** — DNS lookups transition gradually as caches expire.

### 1.4 Verify Cloudflare has taken over

Run on your laptop:
```bash
dig vintra.my.id NS +short
```
When you see Cloudflare nameservers in the output (instead of `ns1.dns-parking.com` or whatever Hostinger uses), DNS migration is complete.

Also visit https://vintra.my.id — should still load fine (Cloudflare is now proxying).

### 1.5 Add the wildcard A record

In Cloudflare → **DNS** → **Records** → **Add record**:
- Type: **A**
- Name: `*` (just the asterisk)
- IPv4 address: `15.232.90.20` (your Lightsail IP)
- Proxy status: **Proxied** (orange cloud, NOT grey)
- TTL: Auto

Click Save.

### 1.6 Verify wildcard works at DNS level

```bash
dig test.vintra.my.id +short
```
Should return Cloudflare proxy IPs (104.x.x.x / 172.x.x.x range), not your origin IP. That means Cloudflare is intercepting wildcard requests as expected.

---

## Phase 2: SSL — Cloudflare Origin Certificate (recommended)

Why: 15-year validity, zero renewal pain, free. Only works behind Cloudflare proxy (which we just enabled in step 1.5), so this is a natural fit.

### 2.1 Generate the cert

In Cloudflare → **SSL/TLS** → **Origin Server** → **Create Certificate**:
- Key type: **RSA** (2048-bit is fine)
- Hostnames: `vintra.my.id, *.vintra.my.id` (both, comma-separated)
- Certificate validity: **15 years**
- Click **Create**

Cloudflare shows you two text blobs:
- **Origin Certificate** (the cert)
- **Private Key** (the key)

⚠️ **The private key is shown ONCE.** If you close this page without saving it, you have to revoke + regenerate. Copy it to a secure scratchpad NOW.

### 2.2 Configure Cloudflare SSL mode

Same SSL/TLS section → **Overview** tab → set encryption mode to **Full (strict)**.

This means: browser ↔ Cloudflare = Cloudflare's universal SSL (auto). Cloudflare ↔ origin = the cert you just generated.

### 2.3 Copy the cert to the server

SSH in:
```bash
ssh -i ./vintra-prod.pem ubuntu@15.232.90.20
```

Create the cert directory + paste the files:
```bash
sudo mkdir -p /etc/ssl/cloudflare
sudo nano /etc/ssl/cloudflare/vintra.my.id.pem
# paste the Origin Certificate, save (Ctrl-O, Enter, Ctrl-X)

sudo nano /etc/ssl/cloudflare/vintra.my.id.key
# paste the Private Key, save

sudo chmod 600 /etc/ssl/cloudflare/vintra.my.id.key
sudo chmod 644 /etc/ssl/cloudflare/vintra.my.id.pem
```

---

## Phase 3: Deploy the wildcard nginx vhost

Wait until I've pushed JUR-185 code to staging first. Once I confirm, do:

### 3.1 Copy the vhost file from the repo

```bash
# From your laptop, in the Vintra repo root:
scp -i ./vintra-prod.pem deploy/nginx/public-tenant.conf \
  ubuntu@15.232.90.20:/tmp/public-tenant.conf
```

### 3.2 Install + enable

```bash
ssh -i ./vintra-prod.pem ubuntu@15.232.90.20

sudo mv /tmp/public-tenant.conf /etc/nginx/sites-available/public-tenant
sudo ln -s /etc/nginx/sites-available/public-tenant /etc/nginx/sites-enabled/

# Sanity check
sudo nginx -t
# Should say: "syntax is ok" + "test is successful"

# Reload
sudo systemctl reload nginx
```

**Updating the vhost later:** always `scp` into `sites-available/` and
let the symlink propagate. If you ever copy directly into
`sites-enabled/` (or scp from a tool that helpfully "fixes" the
symlink into a regular file), edits to `sites-available/` will stop
propagating and the next reload will use stale config — see the
"Only HTML requests are supported here" entry in troubleshooting.
Confirm with `ls -la /etc/nginx/sites-enabled/public-tenant` — it
must show `→ /etc/nginx/sites-available/public-tenant`, not a
regular file.

### 3.3 Deploy the app code

Standard deploy:
```bash
# From laptop in repo root:
./deploy.sh web
```

This pushes the new migration (already applied to prod by me via supabase MCP, so it's a no-op), the new routes, and the new server fns.

---

## Phase 4: Smoke test

### 4.1 Claim a test slug

1. Log into Vintra as your test tenant (e.g. Mantra Maker)
2. Go to `/booking/settings`
3. Scroll to the **URL Publik** card
4. Enter `cuci-mantra` (or whatever slug you want)
5. Click **Klaim**

You should see the slug saved + a `cuci-mantra.vintra.my.id` preview link with a copy button.

### 4.2 Visit the public URL

1. Click the preview link OR open a new tab and visit `https://cuci-mantra.vintra.my.id`
2. Expected:
   - Browser URL bar shows `cuci-mantra.vintra.my.id` (not redirected)
   - Page renders with tenant name, address, today's hours
   - If queue mode is set + you have bookings: live queue card with per-bay counts
   - Services list with prices
   - "Powered by Vintra" footer link

### 4.3 Test 404 path

Visit `https://nonexistent-tenant-xyz.vintra.my.id` — should show the "Halaman tidak ditemukan" message, not a crash or the SaaS app.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `cuci-mantra.vintra.my.id` returns SSL error | Wildcard A record not pointing to origin, or origin cert not installed | Re-check phase 1.5 + 2.3 |
| `cuci-mantra.vintra.my.id` returns 502 | nginx vhost reloaded but Node not running, or cert file paths wrong | `pm2 status vintra-web` + `sudo nginx -t` |
| Subdomain shows the regular Vintra app instead of the queue page | nginx vhost not enabled or wildcard regex not matching | Check `ls /etc/nginx/sites-enabled/` includes `public-tenant`, check `sudo nginx -T` output for the regex vhost |
| Subdomain shows queue page but page is broken (no styles) | Static asset paths aren't being served (the `_build`/`assets`/`images`/`fonts` location block) | Verify the location block exists in the deployed vhost (`sudo cat /etc/nginx/sites-available/public-tenant`) |
| Queue numbers don't refresh | refetchInterval polling not firing (rare, check browser devtools network tab) | Hard refresh; check `getPublicQueueData` returns 200 in network panel |
| Subdomain SSR renders the queue page but the client immediately shows "Something went wrong!" with `POST /_serverFn/<hash>` → 500 `{"error":"Only HTML requests are supported here"}` | `sites-enabled/public-tenant` is a stale **regular file**, not a symlink to `sites-available/`, so a leftover `rewrite ^(.+)$ /q/$sub$1 break;` is still rewriting `_serverFn` paths to `/q/<sub>/_serverFn/<hash>` — that no longer starts with `SERVER_FN_BASE` so TanStack Start falls through to the route handler, which rejects non-HTML Accept. Fix: `sudo rm /etc/nginx/sites-enabled/public-tenant && sudo ln -s /etc/nginx/sites-available/public-tenant /etc/nginx/sites-enabled/public-tenant && sudo nginx -t && sudo systemctl reload nginx` |

---

## Optional hardening (defer until production)

These are not needed for JUR-185 launch but worth knowing about:

### Origin IP exposure

Right now, anyone who finds `15.232.90.20` can bypass Cloudflare. For most use cases, Cloudflare's universal protection is enough. To harden:

- **Cloudflare IP allowlisting at nginx**: only accept connections from Cloudflare IP ranges (https://www.cloudflare.com/ips/). One-time `ufw` or nginx `allow`/`deny` setup. Risk: if Cloudflare changes IPs and your allowlist is stale, your origin becomes unreachable.

### Cloudflare WAF rules

The free tier includes basic DDoS protection automatically. If you want WAF custom rules (rate limit per IP, country blocking, etc.), free tier offers limited rules; Pro tier ($20/mo per domain) gives much more.

For now: stick with the defaults. Revisit only if you see actual abuse.

---

**Done.** Total runbook time: ~45 min hands-on, plus the DNS propagation wait. Send a thumbs up when you've finished Phase 1 — I'll have code ready by then, and we can do Phase 3+4 together.
