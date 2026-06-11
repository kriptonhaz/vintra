---
"@vintra/web": patch
---

Tag S3 uploads with `kind=attendance` or `kind=financial-proof` on PutObject. Lets a tag-filtered S3 lifecycle rule purge attendance selfies after N days without ever touching financial proofs (which need long-term retention for accounting/audit). No behaviour change for existing files.
