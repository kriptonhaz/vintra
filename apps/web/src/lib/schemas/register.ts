import { z } from 'zod'

export const registerFormSchema = z
  .object({
    fullName: z.string().min(1, 'Nama lengkap wajib diisi'),
    businessName: z.string().min(1, 'Nama usaha wajib diisi'),
    email: z
      .string()
      .min(1, 'Email wajib diisi')
      .email('Format email tidak valid'),
    password: z
      .string()
      .min(1, 'Password wajib diisi')
      .min(6, 'Password minimal 6 karakter'),
    confirmPassword: z.string().min(1, 'Konfirmasi password wajib diisi'),
    // JUR-91: optional referral code. The form prefills this from the
    // ?ref= URL param or jq_ref cookie when present. Live-validated on
    // blur via validateReferralCode(); invalid/inactive codes don't
    // block submit (the attribution just won't be created).
    referralCode: z.string().optional().or(z.literal('')),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Password tidak cocok',
    path: ['confirmPassword'],
  })

export type RegisterFormData = z.infer<typeof registerFormSchema>
