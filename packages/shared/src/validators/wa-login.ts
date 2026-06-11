import { z } from 'zod'

/**
 * Canonicalize an Indonesian phone string to the "62XXXXXXXXXX" form
 * (digits only, no leading "+"). Tolerates the common entry formats:
 *
 *   "08123456789"    → "628123456789"
 *   "8123456789"     → "628123456789"
 *   "628123456789"   → "628123456789"
 *   "+62 812-345-678" → "62812345678"
 *
 * Returns `null` when the result falls outside the 10–14 char
 * Indonesian E.164 mobile range — callers should treat this as
 * "unparseable, ask the user to fix".
 *
 * MUST stay byte-equivalent to `walogin.NormalizeIDPhone` in
 * apps/api/internal/walogin/phone.go — both ends of the WhatsApp OTP
 * flow normalize independently and the resulting strings have to be
 * equal for the DB lookup to match.
 */
export function normalizeIDPhone(input: string): string | null {
  if (!input) return null
  let digits = ''
  for (const ch of input) {
    if (ch >= '0' && ch <= '9') digits += ch
  }
  if (!digits) return null

  if (digits.startsWith('62')) {
    // already E.164 — keep as is.
  } else if (digits.startsWith('0')) {
    digits = '62' + digits.slice(1)
  } else if (digits.startsWith('8')) {
    digits = '62' + digits
  }

  if (digits.length < 10 || digits.length > 14) return null
  return digits
}

/**
 * Storage-side coercer for any field that holds an Indonesian phone
 * string. Used by tenant_members.phone writes so the DB always carries
 * the canonical "62XXXXXXXXXX" form — letting the WA-login lookup use
 * a direct equality query instead of an O(N) Go-side scan.
 *
 * Behavior:
 *   - null / undefined / empty / whitespace → null
 *   - parseable Indonesian number → normalized to "62XXXXXXXXXX"
 *   - unparseable but non-empty → trimmed input preserved (no data loss)
 *
 * The fallback exists because some legacy rows / edge-case inputs
 * (foreign numbers, mistakes mid-typing) shouldn't be silently wiped.
 * The WA-login lookup just won't match those rows — which is the same
 * failure mode they'd have under the old O(N) Go scan.
 */
export function coerceStorablePhone(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  return normalizeIDPhone(trimmed) ?? trimmed
}

/**
 * Zod schema for a phone-input field that gets normalized in-flight.
 * Form errors message in Bahasa Indonesia per the project convention.
 *
 * Usage:
 *
 *   const schema = z.object({ phone: phoneInput })
 *   schema.parse({ phone: '08123456789' })  // → { phone: '628123456789' }
 */
export const phoneInput = z
  .string()
  .min(6, 'Nomor HP tidak valid')
  .transform((v, ctx) => {
    const normalized = normalizeIDPhone(v)
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Format nomor HP tidak dikenali',
      })
      return z.NEVER
    }
    return normalized
  })

/**
 * Schema for the 6-digit code submitted at the verify step. Strict
 * exact-length check; the API also enforces this so any client-side
 * leniency would only cause the API to reject the request.
 */
export const otpCode = z.string().regex(/^\d{6}$/, 'Kode OTP harus 6 digit angka')

/** Common shape of `/auth/wa-login/request` server-fn input. */
export const waLoginRequestSchema = z.object({
  tenantSlug: z.string().min(1, 'Slug tenant wajib diisi'),
  phone: phoneInput,
})

/** Common shape of `/auth/wa-login/verify` server-fn input. */
export const waLoginVerifySchema = z.object({
  tenantSlug: z.string().min(1, 'Slug tenant wajib diisi'),
  phone: phoneInput,
  otp: otpCode,
})

export type WaLoginRequestInput = z.input<typeof waLoginRequestSchema>
export type WaLoginVerifyInput = z.input<typeof waLoginVerifySchema>
