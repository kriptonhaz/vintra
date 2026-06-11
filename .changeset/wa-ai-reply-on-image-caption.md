---
"@vintra/web": patch
"@vintra/db": patch
"@vintra/shared": patch
---

Fix AI auto-reply silently skipping inbound image/video/document
messages that have a caption. The wa:incoming worker only
enqueued ai:reply when `type == "text"`, so a customer asking
"saya mau beli ini" with a product photo got persisted but no
reply ever fired.

Now any inbound with non-empty body (text OR media caption) gets
routed to the AI. Pure media without a caption is still skipped
(vision is out of scope for v1) — sidebar shows the message,
operator handles manually.
