---
"@vintra/web": patch
---

Fix inventory item photo being wiped when editing other fields. `updateInventoryItem` was unconditionally setting `photoKey` to `null` because the edit form never sends `photoKey` (photo is managed by separate upload/remove server functions). It now only touches `photoKey` when explicitly provided, leaving an existing photo intact on metadata-only edits.
