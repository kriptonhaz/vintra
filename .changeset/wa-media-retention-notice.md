---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp: surface the 24-hour media retention policy so tenants don't
hit "media tidak tersedia" placeholders by surprise.

- Dashboard: prominent blue info card under the stat cards explaining
  that foto/video/dokumen are auto-deleted after 24h while text
  messages stay permanent.
- Chat composer: paperclip tooltip rephrased to call out the 24-hour
  window, and the staged-image preview's metadata line now says
  "X KB · disimpan 24 jam" so it shows up at the moment of upload.

Mirrors the actual JUR-79 S3 lifecycle policy (kind=wa-media, 1-day
expiry).
