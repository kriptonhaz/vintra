---
"@vintra/web": minor
"@vintra/db": minor
---

Add digital loyalty stamp cards. Merchants upload a card design + stamp mark and align a grid overlay in the stamp-program editor; the Go API pre-renders every fill state (0..N stamps) once into permanent S3 objects. The WhatsApp AI auto-reply attaches the customer's current card (matched to their stamp count) when stamps come up in conversation, and staff can manually send a customer their card from the customer detail page. Builds on the existing stamp-program + RAG + wa:send_image plumbing.

Note: the API binary must be redeployed for the render pipeline and auto-reply image follow-up to activate.
