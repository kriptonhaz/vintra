import { db } from './client'
import { masterHppUnits } from './schema'

const units = [
  { value: 'gram', label: 'Gram (g)', sortOrder: 1 },
  { value: 'kg', label: 'Kilogram (kg)', sortOrder: 2 },
  { value: 'ml', label: 'Mililiter (ml)', sortOrder: 3 },
  { value: 'liter', label: 'Liter (L)', sortOrder: 4 },
  { value: 'pcs', label: 'Pieces (pcs)', sortOrder: 5 },
  { value: 'pack', label: 'Pack', sortOrder: 6 },
  { value: 'box', label: 'Box', sortOrder: 7 },
  { value: 'sachet', label: 'Sachet', sortOrder: 8 },
  { value: 'botol', label: 'Botol', sortOrder: 9 },
  { value: 'kaleng', label: 'Kaleng', sortOrder: 10 },
  { value: 'lembar', label: 'Lembar', sortOrder: 11 },
  { value: 'porsi', label: 'Porsi', sortOrder: 12 },
  { value: 'sendok', label: 'Sendok', sortOrder: 13 },
  { value: 'cup', label: 'Cup', sortOrder: 14 },
]

async function seed() {
  console.log('Seeding master data...')

  await db.insert(masterHppUnits).values(units).onConflictDoNothing()
  console.log(`  Inserted ${units.length} HPP units`)

  console.log('Seed complete!')
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
