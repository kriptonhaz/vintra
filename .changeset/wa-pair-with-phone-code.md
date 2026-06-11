---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

WhatsApp: alternative pairing flow via phone-linking code (no QR scan).

Solves the chicken-and-egg for merchants who open the dashboard on
the same phone they want to link — they can't realistically scan a QR
code on the same screen. Now they enter their number, get a 6-char
code, paste it into WhatsApp's "Tautkan dengan nomor telepon" flow.

- Go api: `POST /v1/wa/instances/:id/pair-code` calls
  `whatsmeow.PairPhone` after waiting for the socket to reach the
  pairing-ready state. Same auth + tenant middleware as Connect;
  same purge-on-logged-out hygiene.
- Web: `pairWaInstanceWithCode` server fn gated by `whatsapp.manage`
  (owner/admin only, same as Connect). New "Gunakan Kode" button
  next to "Pindai QR" on the instance detail header + on the
  `NotPairedGate` empty state.
- Code dialog shows the linking code in a large mono font with
  step-by-step Indonesian instructions matching WhatsApp's mobile UI.
