/**
 * Toko Online — client-side cart store.
 *
 * Module-level external store (useSyncExternalStore) persisted to
 * localStorage, scoped per tenant slug. Lives outside React so the
 * shop section (which adds items) and the floating cart drawer (which
 * reads them) share state without a provider — both render inside the
 * public site page, and the editor preview simply never writes to it.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type CartItem = {
  itemId: string
  /** Chosen variant, when the product has variants. Null otherwise. */
  variantId: string | null
  /** Variant label snapshot, e.g. "M / Merah". Null for plain items. */
  variantLabel: string | null
  name: string
  /** Unit price snapshot at add time (re-priced server-side on order). */
  unitPrice: number
  qty: number
  imageUrl: string | null
  /** Max sellable online (branch stock capped by onlineStockCap); null = no cap. */
  maxQty: number | null
  weightGrams: number | null
}

/** Stable identity of a cart line — variant when present, else the item. */
export function cartLineKey(i: {
  itemId: string
  variantId: string | null
}): string {
  return i.variantId ?? i.itemId
}

const EMPTY: CartItem[] = []

let state: { slug: string; items: CartItem[] } = { slug: '', items: [] }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function storageKey(slug: string) {
  return `vintra-cart:${slug}`
}

function load(slug: string) {
  let items: CartItem[] = []
  try {
    const raw = localStorage.getItem(storageKey(slug))
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) items = parsed as CartItem[]
    }
  } catch {
    items = []
  }
  state = { slug, items }
}

function persist() {
  try {
    localStorage.setItem(storageKey(state.slug), JSON.stringify(state.items))
  } catch {
    // localStorage unavailable (private mode / quota) — cart stays in-memory.
  }
}

/** Lazily load the slug's cart the first time it's referenced. */
function ensureLoaded(slug: string) {
  if (state.slug !== slug) {
    load(slug)
    emit()
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): CartItem[] {
  return state.items
}

function getServerSnapshot(): CartItem[] {
  return EMPTY
}

function clampQty(qty: number, max: number | null): number {
  const q = Math.max(0, Math.floor(qty))
  if (max != null && q > max) return max
  return q
}

export function useCart(slug: string) {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    ensureLoaded(slug)
  }, [slug])

  const add = useCallback(
    (item: Omit<CartItem, 'qty'>, qty = 1) => {
      ensureLoaded(slug)
      const k = cartLineKey(item)
      const existing = state.items.find((i) => cartLineKey(i) === k)
      let next: CartItem[]
      if (existing) {
        next = state.items.map((i) =>
          cartLineKey(i) === k
            ? { ...i, ...item, qty: clampQty(i.qty + qty, item.maxQty) }
            : i,
        )
      } else {
        const startQty = clampQty(qty, item.maxQty)
        next =
          startQty > 0 ? [...state.items, { ...item, qty: startQty }] : state.items
      }
      state = { slug, items: next }
      persist()
      emit()
    },
    [slug],
  )

  const setQty = useCallback(
    (lineKey: string, qty: number) => {
      ensureLoaded(slug)
      const next = state.items
        .map((i) =>
          cartLineKey(i) === lineKey ? { ...i, qty: clampQty(qty, i.maxQty) } : i,
        )
        .filter((i) => i.qty > 0)
      state = { slug, items: next }
      persist()
      emit()
    },
    [slug],
  )

  const remove = useCallback(
    (lineKey: string) => {
      ensureLoaded(slug)
      state = { slug, items: state.items.filter((i) => cartLineKey(i) !== lineKey) }
      persist()
      emit()
    },
    [slug],
  )

  const clear = useCallback(() => {
    state = { slug, items: [] }
    persist()
    emit()
  }, [slug])

  const count = items.reduce((n, i) => n + i.qty, 0)
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.qty, 0)

  return { items, add, setQty, remove, clear, count, subtotal }
}
