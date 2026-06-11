import { createServerFn } from '@tanstack/react-start'
import { db } from '@vintra/db'
import { masterHppUnits } from '@vintra/db/schema'
import { eq, asc } from 'drizzle-orm'

export const getHppUnits = createServerFn().handler(async () => {
  // JUR-14: included `id` so HPP forms can persist unitId (FK) without
  // a second round-trip. value + label kept for legacy callers and
  // for UI display.
  return db
    .select({
      id: masterHppUnits.id,
      value: masterHppUnits.value,
      label: masterHppUnits.label,
    })
    .from(masterHppUnits)
    .where(eq(masterHppUnits.isActive, true))
    .orderBy(asc(masterHppUnits.sortOrder))
})
