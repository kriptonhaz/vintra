---
"@vintra/web": patch
---

Allow stock opname to save when system stock is negative.

`bulkRecordStockOpname` validated `systemStock` with `.min(0)`, so a single row
whose baseline had gone negative rejected the entire opname submission.
`systemStock` is not user input — it is a read of the current balance, which can
legitimately be negative after an oversell, and opname is precisely the tool
meant to reconcile it. Dropped `.min(0)` on `systemStock`, keeping it on the
user-entered `actualQty`.
