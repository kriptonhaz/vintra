---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Landing page cleanup:

- Fix WhatsApp AI "mulai" price: was Rp 99rb (wrong), now Rp 49rb (matches the Basic tier in `apps/web/src/routes/_authed/whatsapp/billing.tsx`).
- Replace the "izin, cuti, dan lembur" bullet in the Absensi highlight section — that feature isn't built. Swapped for two real attendance features (GPS + photo validation, downloadable monthly reports). Filed JUR-95 to revisit when there's demand.
- Mention WhatsApp AI in the hero subtitle so it's not buried below the fold.
- Footer: removed the IG/TW/FB/YT social-icon placeholders (no real accounts to link to), wired up the Produk anchors to the actual highlight sections (`/#hpp`, `/#absensi`, `/#whatsapp`; POS + Manajemen Stok land at `/#fitur` until they get their own highlight sections), and added a WhatsApp AI entry.
- Renamed the HppHighlight section id from the generic `#solusi` to `#hpp` and updated the hero "Lihat Demo" CTA reference accordingly. Added `#absensi` to AttendanceHighlight and `#whatsapp` to WhatsappHighlight.
