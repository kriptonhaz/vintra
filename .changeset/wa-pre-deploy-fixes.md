---
"@vintra/web": minor
"@vintra/db": patch
"@vintra/shared": patch
---

Three pre-deploy polish items for WhatsApp v1:

- Linked-device name now shows "Vintra" instead of "whatsmeow" on
  the paired phone's Settings → Linked Devices screen. Existing paired
  instances keep the old name — re-pair (scan QR again) to refresh.
  See https://github.com/tulir/whatsmeow/issues/89.
- "Tambah WhatsApp" button is disabled when the tenant has reached
  their subscription's max instances. Tooltip explains the cap and
  suggests upgrade. (Basic = 1 instance, Komplit = 3.)
- Chat sidebar + conversation header now show the master-data customer
  name (when the contact's phone matches a `customers` row for this
  tenant). The customer's WhatsApp profile name is shown as a secondary
  "WA: {push_name}" line when it differs from the saved name, so the
  operator can confirm it's the right person. No new schema —
  customers.phone is already canonical "628..." from migration 0022.
