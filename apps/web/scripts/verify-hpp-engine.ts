/**
 * Verify the HPP engine against live data.
 *
 * The engine's whole premise is that it reproduces the calculator's arithmetic
 * — so before anything writes through it, it must reproduce every HPP value
 * already stored, for every tenant. A divergence here means the engine would
 * silently move numbers owners price their menu on.
 *
 * Read-only. Reports differences; writes nothing.
 *
 *   bun run verify:hpp
 */
import postgres from 'postgres'
import { computeHpp } from '../src/server/lib/hpp-engine'

const url = process.env['DATABASE_URL']
if (!url) {
  console.error('✗ DATABASE_URL is not set')
  process.exit(2)
}
const sql = postgres(url, { max: 1, prepare: false })

const tenants = await sql<{ id: string; name: string }[]>`
  SELECT id, business_name AS name FROM tenants ORDER BY business_name`

let checked = 0
let stored = 0
let diverged = 0
let unresolvedTotal = 0
const rows: string[] = []

for (const t of tenants) {
  const [products, bom, materials] = await Promise.all([
    sql<
      { id: string; name: string; selling_price: string; production_qty: string | null; hpp: string | null }[]
    >`SELECT id, name, selling_price, production_qty, hpp FROM products WHERE tenant_id = ${t.id}`,
    sql<
      { product_id: string; material_id: string | null; source_product_id: string | null; quantity: string }[]
    >`SELECT product_id, material_id, source_product_id, quantity FROM product_materials WHERE tenant_id = ${t.id}`,
    sql<{ id: string; price_per_unit: string }[]>`
      SELECT id, price_per_unit FROM materials WHERE tenant_id = ${t.id}`,
  ])
  if (products.length === 0) continue

  const result = computeHpp(
    products.map((p) => ({
      id: p.id,
      sellingPrice: Number(p.selling_price ?? 0),
      productionQty: p.production_qty == null ? null : Number(p.production_qty),
    })),
    bom.map((b) => ({
      productId: b.product_id,
      materialId: b.material_id,
      sourceProductId: b.source_product_id,
      quantity: Number(b.quantity ?? 0),
    })),
    new Map(materials.map((m) => [m.id, Number(m.price_per_unit ?? 0)])),
  )

  unresolvedTotal += result.unresolved.length

  for (const p of products) {
    checked++
    if (p.hpp == null) continue // never calculated — nothing to reproduce
    stored++
    const computed = result.values.get(p.id)
    if (!computed) {
      diverged++
      rows.push(`  ${t.name} / ${p.name}: stored ${p.hpp}, engine could not resolve (cycle?)`)
      continue
    }
    // Compare at storage precision.
    const a = Math.round(Number(p.hpp) * 100)
    const b = Math.round(computed.hpp * 100)
    if (a !== b) {
      diverged++
      rows.push(
        `  ${t.name} / ${p.name}: stored Rp ${Number(p.hpp).toLocaleString('id-ID')} vs engine Rp ${computed.hpp.toLocaleString('id-ID')}`,
      )
    }
  }
}

await sql.end()

console.log('\nHPP engine vs stored values')
console.log('─'.repeat(60))
console.log(`  tenants          : ${tenants.length}`)
console.log(`  products checked : ${checked}`)
console.log(`  with a stored HPP: ${stored}`)
console.log(`  unresolved (cycle): ${unresolvedTotal}`)
console.log(`  divergences      : ${diverged}`)
if (rows.length) {
  console.log('\ndifferences:')
  for (const r of rows.slice(0, 30)) console.log(r)
  if (rows.length > 30) console.log(`  … and ${rows.length - 30} more`)
}
console.log('─'.repeat(60))
if (diverged > 0) {
  console.error('✗ The engine does not reproduce stored values — do NOT write through it.')
  process.exit(1)
}
console.log('✓ Engine reproduces every stored HPP exactly.')
