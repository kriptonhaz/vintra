import { z } from 'zod'
import { PO_PAYMENT_METHODS } from '@/lib/po-payment'

export const poPaymentFormSchema = z.object({
  /** Raw numeric string from CurrencyInput. */
  amount: z
    .string()
    .min(1, 'Jumlah wajib diisi')
    .refine((v) => Number(v) > 0, 'Jumlah harus lebih dari 0'),
  method: z.enum(PO_PAYMENT_METHODS),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Tanggal bayar wajib diisi'),
  note: z.string().max(500, 'Catatan maksimal 500 karakter').optional(),
})

export type PoPaymentFormValues = z.infer<typeof poPaymentFormSchema>
