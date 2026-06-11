---
"@vintra/web": minor
"@vintra/db": minor
---

POS: per-category loyalty stamp / punch-card programs (JUR-195).

Adds a stamp-card feature alongside the existing points system. A tenant defines a program bound to a product category (e.g. "Cuci Motor"), a stamps-required count, and a reward item. Qualifying purchases stamp the customer's card per quantity, and a full card pays out the reward item for free at checkout. Counts are scoped per category, so a motor-wash card and a car-wash card accumulate independently for the same customer. Gated behind the Komplit `loyalty_points` feature.
