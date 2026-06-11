---
"@vintra/web": minor
"@vintra/db": minor
"@vintra/shared": patch
---

Attendance Phase 2 — real clock-in / clock-out with multi-mode verification. New DB tables `attendance_records`, `qr_host_sessions`, `qr_consumed_nonces` (migration 0006). Server functions `submitClockIn` / `submitClockOut` validate ALL enabled modes simultaneously (haversine GPS check, AWS S3 photo upload, HMAC-signed QR token with one-shot nonce replay protection) and derive `on_time` / `late` / `early_leave` status in Jakarta timezone. New `/attendance/qr-host` page (owner/admin only) renders a rotating QR that auto-refreshes every `qrRotationSeconds`. Staff check-in page now orchestrates GPS / Photo / QR capture sub-components and submits proofs in one request. Photo storage uses AWS S3 with short-lived signed GET URLs. Adds deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `qrcode`, `@zxing/browser`. Requires env vars: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`, `ATTENDANCE_QR_SECRET`.
