---
"@vintra/web": patch
---

Fix: the "Tanggal Bergabung" date input on the team-member form (`/settings/members`) now renders as `dd/mm/yyyy`. Native `<input type="date">` formats by the **browser** locale, so Indonesian users on en-US-locale browsers were seeing — and typing into — an `mm/dd/yyyy` field and mis-reading the date. A new `DateInput` component renders a strict `dd/mm/yyyy` text mask; the on-the-wire value is still ISO `yyyy-mm-dd`, so the schema and server contract are unchanged.
