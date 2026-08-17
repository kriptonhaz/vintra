---
"@vintra/web": minor
---

Show what a manual ingredient-price edit will do before applying it, and
cascade it in the same transaction.

Editing a bahan baku price now previews the consequences first: how many
products move, by how much, and — listed by name, worst first — which ones
would end up selling under a 20% margin. Confirming applies the price and
recalculates every affected product atomically. Selling prices are never
touched, and the dialog says so.

A manual edit asks; a stock-in does not. The person typing a new ingredient
price is the person who sets menu prices, so the question is answerable. The
crew receiving goods are not, which is why that path stays silent and notifies
afterwards.

The dialog only appears when the price actually moved AND something is actually
affected — renaming an ingredient, or repricing one no recipe uses, saves
straight through. Confirming re-enters the same save handler with a flag rather
than duplicating the write, so the confirmed and unconfirmed paths cannot drift
apart.

`previewMaterialPriceImpact` is read-only: it computes the recipe graph twice,
once as stored and once with the price substituted, and diffs them. Verified
against production — a hypothetical doubling of "Butter Bos" reported 6
affected products averaging +Rp 2.250, and left the stored price untouched.
