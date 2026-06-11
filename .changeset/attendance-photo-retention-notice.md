---
"@vintra/web": patch
---

Surface the 60-day attendance-photo retention policy in the UI: a prominent info card on /attendance/settings explaining the cleanup, plus a subtle one-line reminder under the records list. Lets owners back up or export photos before the S3 lifecycle rule expires them, instead of being surprised by missing images during a later audit.
