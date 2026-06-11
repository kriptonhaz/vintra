---
"@vintra/web": patch
---

Update deployment docs to reflect AWS Lightsail migration:

- Root `README.md`: replace Netlify deployment section with a Lightsail
  summary + production stack table, and link to the full `deploy/README.md`.
- `deploy/README.md`: expand substantially with troubleshooting (nginx
  404s with permission-denied, PM2 command-not-found, missing env vars,
  certbot HTTP-01 failures), architecture notes, and the gotchas we hit
  during the actual cutover (Lightsail's `/home/ubuntu` 0750 perms,
  non-interactive SSH skipping nvm, env at repo root vs `apps/web/`).
