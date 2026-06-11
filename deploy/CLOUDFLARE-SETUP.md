# Cloudflare setup — vintra.my.id

Step-by-step to put the **new** `vintra.my.id` domain behind Cloudflare. This is
the **first** infra task — it has zero dependency on the VPS, and nameserver
propagation is the slowest part, so start it before provisioning Lightsail.

> **Note vs the `SUBDOMAIN-DEPLOY.md` runbook:** this domain is
> brand new with nothing on it, so you can **skip all the "preserve existing
> MX/SPF records" caution** — there's nothing to import yet.

## TLS strategy (so the later steps make sense)

This stack uses **two** cert strategies — both need the VPS to exist, so they're
deferred to after Lightsail:

| Hostname | Cert | Proxy (cloud) |
| --- | --- | --- |
| `vintra.my.id`, `www` | Let's Encrypt (certbot) | grey to issue → orange after |
| `api.vintra.my.id` | Let's Encrypt (certbot) | grey to issue → orange after |
| `*.vintra.my.id` (tenant pages) | Cloudflare Origin Certificate (15-yr) | orange (proxied) |

---

## Phase 1 — Point vintra.my.id at Cloudflare (do this NOW)

### 1. Create / log into Cloudflare (free)

- https://dash.cloudflare.com/sign-up — free tier is all you need; skip paid upsells.
- Reusing an existing Cloudflare account is fine — just add `vintra.my.id` as a
  second zone (free plan allows many zones).

### 2. Add `vintra.my.id` as a site

1. Dashboard → **Onboard a domain** (top-right; the new name for "Add a site").
   - `.my.id` can't be *transferred* to Cloudflare Registrar — when the
     ".my.id domains aren't supported yet" dialog appears, click
     **Add site anyway**. We only want DNS + proxy, not a registration transfer.
2. Choose the **Free** plan.
3. Cloudflare scans existing DNS and imports Hostinger's **parking records**
   (e.g. `A vintra.my.id → 2.57.91.91`, `CNAME www`). `2.57.91.91` is Hostinger
   parking, not our server — **Delete both** records in Cloudflare. We add the
   real VPS records in Phase 2.

### 3. Copy the 2 Cloudflare nameservers

Cloudflare shows two, like:

```
xxxx.ns.cloudflare.com
yyyy.ns.cloudflare.com
```

(your exact names differ). Keep this tab open.

### 4. Set those nameservers at the registrar (Hostinger)

In Hostinger: **Domain → vintra.my.id → DNS/Nameserver**. The current values are
`byte.dns-parking.com` / `pixel.dns-parking.com`.

1. Click **Ubah nameserver** (Change nameserver).
2. Choose **custom nameservers** (Gunakan nameserver kustom).
3. Replace the two `dns-parking.com` entries with the **two Cloudflare
   nameservers**.
4. Save.

> Once nameservers point to Cloudflare, Hostinger's "Kelola DNS record" section
> is **no longer used** — manage all records in Cloudflare from now on. Don't
> edit DNS in both places.

> **.my.id notes:** some `.id` registrar panels require an OTP/email confirm to
> change nameservers, and `.id` propagation can be a little slower than `.com`
> (~30 min up to 24h). Nothing breaks meanwhile — there's no live site yet.

### 5. Back in Cloudflare, finish setup

- Click **Done, check nameservers** (or **Continue**). Cloudflare polls until it
  detects the change and emails you "vintra.my.id is now active."

### 6. Verify from your laptop

```bash
dig vintra.my.id NS +short
```

When the output shows the two `*.ns.cloudflare.com` names, migration is done.

---

## Phase 2 — DNS records + SSL (AFTER Lightsail has a static IP)

Come back here once the VPS exists and you know its IP. Replace `<VPS_IP>` below.

### 2.1 Add DNS records

Cloudflare → **DNS** → **Records** → **Add record** (one per row):

| Type | Name | Content | Proxy | Notes |
| --- | --- | --- | --- | --- |
| A | `@` | `<VPS_IP>` | DNS only (grey) at first | apex `vintra.my.id` |
| A | `www` | `<VPS_IP>` | DNS only (grey) at first | |
| A | `api` | `<VPS_IP>` | DNS only (grey) at first | `api.vintra.my.id` |
| A | `*` | `<VPS_IP>` | **Proxied (orange)** | wildcard — tenant public pages |

Why grey-cloud the apex/www/api first: certbot's HTTP-01 challenge must reach the
origin directly. Once Let's Encrypt certs are issued on the server, flip
apex/www/api to **Proxied (orange)**.

### 2.2 Issue Let's Encrypt certs on the server (apex + api)

On the VPS, after nginx vhosts are in place (`server_name vintra.my.id ...`):

```bash
sudo certbot --nginx -d vintra.my.id -d www.vintra.my.id
sudo certbot --nginx -d api.vintra.my.id
```

Then flip apex/www/api records to orange in Cloudflare.

### 2.3 Cloudflare Origin Certificate (wildcard `*.vintra.my.id`)

1. Cloudflare → **SSL/TLS** → **Origin Server** → **Create Certificate**.
2. Key type: **RSA** (2048-bit). Hostnames: `vintra.my.id, *.vintra.my.id`.
   Validity: **15 years** → **Create**.
3. ⚠️ The **Private Key is shown once** — copy both blobs to a secure scratchpad now.
4. On the server:
   ```bash
   sudo mkdir -p /etc/ssl/cloudflare
   sudo nano /etc/ssl/cloudflare/vintra.my.id.pem   # paste Origin Certificate
   sudo nano /etc/ssl/cloudflare/vintra.my.id.key   # paste Private Key
   sudo chmod 600 /etc/ssl/cloudflare/vintra.my.id.key
   sudo chmod 644 /etc/ssl/cloudflare/vintra.my.id.pem
   ```
   (The `public-tenant.conf` nginx vhost points at these paths.)

### 2.4 Set SSL/TLS mode

Cloudflare → **SSL/TLS** → **Overview** → encryption mode = **Full (strict)**.

- browser ↔ Cloudflare = Cloudflare universal SSL (auto)
- Cloudflare ↔ origin = the certs above

### 2.5 Verify

```bash
dig test.vintra.my.id +short   # → Cloudflare proxy IPs (104.x / 172.x), not origin
curl -sS https://vintra.my.id | head -3
```

---

## Related Cloudflare config used by the app

The codebase already integrates Cloudflare — set these in `apps/web/.env` when ready:

- **Turnstile** (captcha on `/contact`): `VITE_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
  — Cloudflare → Turnstile → Add site (Managed mode).
- **Cache purge** (instant publish): `CLOUDFLARE_API_TOKEN` (Zone → Cache Purge
  permission), `CLOUDFLARE_ZONE_ID` (on the zone Overview page).

## If you'll send email from this domain (Brevo, later)

Email DNS records (MX / SPF / DKIM TXT) live in **this same Cloudflare zone**.
Brevo gives you the exact records to add when you set up the sender domain.

---

## Pre-req before the Phase 2 cert step

nginx vhosts, `VAPID_SUBJECT`, `API_URL`, etc. still reference **`vintra.my.id`**
(184 refs). The certbot `server_name` and Origin Cert hostnames must say
`vintra.my.id` first. Run the `vintra.my.id → vintra.my.id` rename sweep before 2.2.
