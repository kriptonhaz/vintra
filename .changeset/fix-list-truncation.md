---
"@vintra/web": patch
---

Make the transaction history and stock movement ledger navigable, and apply a
date bound that was being silently ignored.

Three defects ported from JuraganQu, where a live tenant hit them. All are
latent here — Vintra has no tenant with enough rows to expose them yet — but
each becomes visible the moment one does.

**POS transaction history** fetched a hardcoded page 1 of 100 and rendered no
pager. The list is newest-first, so a branch ringing a few hundred sales a day
would show only its most recent hours and read as "the morning is missing".
Quiet outlets stay under 100 and look fine, which is why it surfaces unevenly.
Adds page controls with a "Menampilkan X–Y dari Z transaksi" count. The server
already returned `total` and computed reconciliation totals over the whole
filtered range, so those figures were right all along — only the list was cut.

**Stock movement ledger** was worse: page 1 of 50, no pager, and no filters at
all. Every POS sale books a row per ingredient, so a busy outlet writes
thousands a day and the screen showed the last few minutes. Paging alone would
be dozens of pages per day, so it now opens on today and offers the two cuts an
owner comes here for — a date range and a single item — alongside the pager.

**`listInventoryMovements` declared a `to` bound and never applied it.** A
caller asking for a date range got the entire history back with nothing to say
the upper bound had been ignored. The bound now covers the whole named day.

Also raises the item list feeding the picker and the new filter from 200 to the
server's 500. JuraganQu's largest tenant has exactly 200 active items — zero
headroom, and one more would have made entries vanish from both silently.

Both lists reset to page 1 on any filter change, since a page number from the
previous filter is meaningless and an out-of-range page renders an empty table
that reads as "no records", and both keep their current rows on screen while
the next page loads so the layout does not jump.
