---
"@vintra/web": patch
---

Fix CurrencyInput mangling values that arrive from DB numeric columns. The raw value was parsed with `parseRupiah`, which strips the decimal point as if it were a thousand separator — so an editing value of `6000.00` displayed as `Rp 600.000`. It now parses the raw value as a plain number. Also normalize trailing decimals on the material edit form's purchase price and package quantity fields.
