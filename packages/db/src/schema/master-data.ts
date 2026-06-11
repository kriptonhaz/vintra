import { pgTable, uuid, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core'

export const masterHppUnits = pgTable('master_hpp_units', {
  id: uuid('id').primaryKey().defaultRandom(),
  value: text('value').notNull().unique(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
