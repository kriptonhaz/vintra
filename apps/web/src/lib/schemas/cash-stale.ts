import { z } from 'zod'
import type { CashStaleConfig } from '@vintra/db/schema'

/**
 * #216 — validation for the configurable stale cash-session rule.
 * Shared by the tenant-default writer (updatePOSCashSettings) and the
 * per-branch override writer (updateBranchCashStaleConfig).
 */
export const cashStaleConfigSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('elapsed_hours'),
    // 1–72h. Below 1h would force-close mid-shift; 72h is a sane ceiling.
    hours: z
      .number()
      .int('Jam harus berupa angka bulat')
      .min(1, 'Minimal 1 jam')
      .max(72, 'Maksimal 72 jam'),
  }),
  z.object({
    mode: z.literal('daily_cutoff'),
    cutoff: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam tidak valid (HH:MM)'),
    // Optional early-morning guard — suppress the flag until the
    // session has been open at least this long past the cutoff.
    minHours: z
      .number()
      .int('Jam harus berupa angka bulat')
      .min(0)
      .max(24)
      .optional(),
  }),
]) satisfies z.ZodType<CashStaleConfig>

export type CashStaleConfigInput = z.infer<typeof cashStaleConfigSchema>
