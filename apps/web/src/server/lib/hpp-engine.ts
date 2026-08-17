/**
 * Authoritative HPP (Harga Pokok Penjualan / COGS) engine.
 *
 * The real formula has lived in the client (`routes/_authed/hpp/calculate.tsx`)
 * while the server's `calculateProductHpp` computed its own, weaker version.
 * That is why they could disagree about the same recipe. This module is that
 * formula moved server-side and made total: recursive, cycle-safe, and ordered
 * so a parent is only computed once every sub-recipe it depends on is final.
 *
 * It also removes a limitation the earlier server fix could not: costing a
 * sub-recipe row from the sub-product's STORED `hpp`, which may itself be
 * stale. Here every product in the graph is recomputed from live material
 * prices in one pass, so a parent never inherits a stale child.
 *
 * FAITHFUL REPLICATION IS THE POINT. This reproduces the calculator's
 * arithmetic rather than "improving" it, because that screen is what owners
 * price their menu from. Deliberate carry-overs:
 *
 *   - Recipe unit vs material unit conversion is NOT applied; quantity is
 *     multiplied by price flat, as the calculator does.
 *   - A sub-recipe with a missing or zero `productionQty` divides by 1, i.e.
 *     costs a full batch (`calculate.tsx:266-269`).
 *   - A missing material price contributes 0, mirroring the calculator, which
 *     renders an empty price field as 0 rather than refusing to save.
 *
 * ONE DELIBERATE DIVERGENCE from JuraganQu's equivalent engine: margin is
 * computed against the PER-UNIT cost, not the batch cost. `products.hpp`
 * stores the cost of one full batch while `sellingPrice` is per unit, so
 * comparing them directly reports a multi-yield recipe as a heavy loss — 42
 * cookies costing Rp 13.308 against a Rp 5.000 unit price reads as -166%.
 * See `perUnitHpp`.
 */
import { calculateMargin, perUnitHpp } from '@/lib/hpp-calculator'

/**
 * Reported for observability, NOT used as a traversal cut-off — the
 * topological order below already terminates on any acyclic graph, and
 * truncating would silently under-count a legitimately deep recipe, which is
 * the exact bug class this module exists to kill.
 */
export const MAX_RECIPE_DEPTH = 8

export interface HppProductInput {
  id: string
  sellingPrice: number
  /** Batch yield. Null or 0 is treated as 1 — see module docs. */
  productionQty: number | null
}

export interface HppBomLine {
  productId: string
  /** Exactly one of materialId / sourceProductId is set (DB CHECK). */
  materialId: string | null
  sourceProductId: string | null
  quantity: number
}

export interface HppComputed {
  /** Cost to produce ONE FULL BATCH (productionQty units), 2 decimals. */
  hpp: number
  /** Percent against the PER-UNIT cost, clamped to numeric(5,2). */
  margin: number
  /** 0 for a pure-material recipe, +1 per level of sub-recipe nesting. */
  depth: number
}

export interface HppComputeResult {
  values: Map<string, HppComputed>
  /**
   * Products that could NOT be computed because they sit in, or depend on, a
   * sub-recipe cycle. Callers must leave these untouched — a stale number is
   * recoverable, a wrong one silently prices a menu.
   */
  unresolved: string[]
  /** Deepest nesting actually seen; compare against MAX_RECIPE_DEPTH. */
  maxDepth: number
}

/** numeric(15,2) — the storage precision of `products.hpp`. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** numeric(5,2) — margin cannot exceed ±999.99 in storage. */
function clampMargin(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(-999.99, Math.min(999.99, round2(n)))
}

/**
 * Pure HPP computation — no database, fully unit-testable.
 *
 * Products are processed in topological order (Kahn): a product is only
 * computed once every sub-recipe it references is final, so a chain like
 * `Biang Teh → Teh Manis → Es Teh Jumbo` resolves correctly in a single pass
 * regardless of input order. Anything still holding unresolved dependencies
 * when the queue drains is part of a cycle, and is reported instead of
 * guessed.
 */
export function computeHpp(
  productList: readonly HppProductInput[],
  bom: readonly HppBomLine[],
  materialPrices: ReadonlyMap<string, number>,
): HppComputeResult {
  const byId = new Map(productList.map((p) => [p.id, p]))

  // Group BOM rows by owning product and collect each product's DISTINCT
  // sub-recipe dependencies. Distinct matters: a recipe may reference the
  // same sub-product on two rows, which would otherwise inflate the in-degree
  // and strand the product as a false cycle.
  const linesByProduct = new Map<string, HppBomLine[]>()
  const depsOf = new Map<string, Set<string>>()
  const dependents = new Map<string, Set<string>>()

  for (const line of bom) {
    if (!byId.has(line.productId)) continue
    const lines = linesByProduct.get(line.productId) ?? []
    lines.push(line)
    linesByProduct.set(line.productId, lines)

    // Edges to products outside the input set (deleted, or another tenant)
    // are ignored; the line then contributes 0, same as the calculator would
    // render for a missing source.
    if (!line.sourceProductId || !byId.has(line.sourceProductId)) continue
    // A row referencing its own product is a trivial self-cycle; drop the
    // edge so the rest of the graph still resolves.
    if (line.sourceProductId === line.productId) continue

    const deps = depsOf.get(line.productId) ?? new Set<string>()
    deps.add(line.sourceProductId)
    depsOf.set(line.productId, deps)

    const dep = dependents.get(line.sourceProductId) ?? new Set<string>()
    dep.add(line.productId)
    dependents.set(line.sourceProductId, dep)
  }

  const remaining = new Map<string, number>()
  const queue: string[] = []
  for (const p of productList) {
    const count = depsOf.get(p.id)?.size ?? 0
    remaining.set(p.id, count)
    if (count === 0) queue.push(p.id)
  }

  const values = new Map<string, HppComputed>()
  let maxDepth = 0

  while (queue.length > 0) {
    const productId = queue.shift()!
    const product = byId.get(productId)!
    const lines = linesByProduct.get(productId) ?? []

    let total = 0
    let depth = 0

    for (const line of lines) {
      if (line.materialId) {
        const price = materialPrices.get(line.materialId) ?? 0
        total += line.quantity * price
        continue
      }
      if (!line.sourceProductId) continue

      const sub = values.get(line.sourceProductId)
      const subProduct = byId.get(line.sourceProductId)
      // Self-reference or out-of-set source: contributes nothing.
      if (!sub || !subProduct) continue

      // `sub.hpp` is the sub-product's BATCH cost, so divide by its yield to
      // get the per-unit price this row is charged at.
      const rawQty = subProduct.productionQty ?? 1
      const batch = rawQty > 0 ? rawQty : 1
      total += line.quantity * (sub.hpp / batch)
      depth = Math.max(depth, sub.depth + 1)
    }

    const hpp = round2(total)
    values.set(productId, {
      hpp,
      // Per-unit, not batch — see the module header.
      margin: clampMargin(
        calculateMargin(
          product.sellingPrice,
          perUnitHpp(hpp, product.productionQty ?? 0),
        ),
      ),
      depth,
    })
    if (depth > maxDepth) maxDepth = depth

    for (const parent of dependents.get(productId) ?? []) {
      const left = (remaining.get(parent) ?? 0) - 1
      remaining.set(parent, left)
      if (left === 0) queue.push(parent)
    }
  }

  const unresolved = productList.filter((p) => !values.has(p.id)).map((p) => p.id)

  return { values, unresolved, maxDepth }
}
