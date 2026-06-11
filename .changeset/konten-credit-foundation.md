---
"@vintra/web": minor
"@vintra/db": minor
---

Add the Konten credit foundation: a per-tenant credit balance (`konten_credit_accounts`) backed by an append-only ledger (`konten_credit_ledger`). 1 credit = 1 AI image generation. Balance and ledger are always written together in one transaction, and a shared `applyKontenCredit` helper guards against overdraft. Platform admins can grant credits from a new "Konten Credits" admin page (no payment gateway yet — manual top-up).
