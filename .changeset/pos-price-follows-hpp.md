---
"@vintra/web": minor
---

POS selling prices now follow the HPP product they sell.

An HPP product and the inventory item created from it describe the same thing
being sold, but carried two independent prices: the price was seeded once at
import and then diverged freely. The HPP screen could report an 84% margin
against Rp 4.000 while the till charged something else — a margin describing a
price nobody was ever charged.

Changing an HPP product's selling price now updates the linked POS item's
tier-1 price on its base unit, in the same transaction. Newly linking an item
adopts that product's price immediately, since its own price field is read-only
from that moment and would otherwise be stranded.

The sync is one-way and deliberately narrow:

- **Only tier-1 on the base unit.** An HPP product carries a single price and
  cannot express a tier ladder ("≥1 Rp 4.000, ≥10 Rp 3.500"). Bulk tiers and
  alternate units stay manual, because inventing values for them would be
  guessing at a merchant's wholesale policy.
- **Only the product being edited**, never the whole tenant. A tenant-wide pass
  would silently resolve divergences on products priced differently on purpose,
  the moment somebody saved any unrelated product.
- **Refused server-side**, in `upsertPricingTier`, not merely hidden in the web
  form — the mobile app calls the same function, so a disabled input would
  protect one client rather than the rule.

The item's price controls are replaced by a link to where the price actually
lives, deep-linking to that product's recipe at step 3 rather than dropping the
owner on the HPP list to find it again. A dead form with no explanation reads
as a bug.

Selling-price moves are NOT written to `hpp_price_history`; that table is a
ledger of cost movements and logging a different kind of event there would blur
what it means.
