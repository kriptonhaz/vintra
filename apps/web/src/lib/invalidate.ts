import type { QueryClient } from '@tanstack/react-query'

/**
 * React Query invalidations for shared tenant data. Multiple surfaces
 * cache the same underlying tables under different keys (e.g. categories
 * are read by Master Data, the POS cashier-masters bundle, the loyalty
 * stamp-form-masters bundle, AND the inventory items filter) — busting
 * only the primary key leaves other surfaces stale until a manual reload.
 *
 * Mutations that create / update / delete the named data should call the
 * matching helper so every surface sees the change immediately.
 *
 * Note: React Query's `invalidateQueries` does prefix matching by default,
 * so a key like `['pos', 'cashier-masters']` invalidates every branch-
 * scoped variant `['pos', 'cashier-masters', branchId]` along with it.
 */

export function invalidateTenantCategories(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['tenant', 'categories'] })
  // POS bundles categories into the cashier + stamp-form masters caches.
  qc.invalidateQueries({ queryKey: ['pos', 'cashier-masters'] })
  qc.invalidateQueries({ queryKey: ['pos', 'stamp-form-masters'] })
  // Inventory items list filters by category.
  qc.invalidateQueries({ queryKey: ['inventory', 'items'] })
}

export function invalidateTenantMaterials(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['tenant', 'materials'] })
  // HPP-linked materials surface in inventory + PO line pickers.
  qc.invalidateQueries({ queryKey: ['inventory', 'items'] })
  qc.invalidateQueries({ queryKey: ['inventory', 'po-items'] })
}

export function invalidateTenantProducts(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['tenant', 'products'] })
  // HPP-linked products surface in inventory and the POS cashier grid.
  qc.invalidateQueries({ queryKey: ['inventory', 'items'] })
  qc.invalidateQueries({ queryKey: ['pos', 'cashier-masters'] })
}

export function invalidateTenantSuppliers(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ['tenant', 'suppliers'] })
  // Supplier picker on PO forms.
  qc.invalidateQueries({ queryKey: ['inventory', 'po-items'] })
}
