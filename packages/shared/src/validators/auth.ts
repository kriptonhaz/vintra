import { z } from 'zod'

export const loginSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
})

export const registerSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
  fullName: z.string().min(1, 'Nama lengkap wajib diisi'),
  businessName: z.string().min(1, 'Nama usaha wajib diisi'),
  // JUR-91: optional referral code captured from ?ref= URL param or
  // typed by the user in the register form. Server-side validation
  // happens inside the register handler — invalid/inactive codes are
  // silently dropped so a stale/typo code doesn't block signup.
  referralCode: z
    .string()
    .regex(/^[A-Z0-9_-]{4,20}$/, 'Format kode referral tidak valid')
    .optional()
    .or(z.literal('')),
})

export const createTenantSchema = z.object({
  name: z.string().min(1, 'Nama usaha wajib diisi'),
  slug: z
    .string()
    .min(3, 'Slug minimal 3 karakter')
    .regex(/^[a-z0-9-]+$/, 'Slug hanya boleh huruf kecil, angka, dan tanda hubung'),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Password saat ini wajib diisi'),
    newPassword: z.string().min(8, 'Password baru minimal 8 karakter'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Konfirmasi password tidak cocok',
    path: ['confirmPassword'],
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Password baru harus berbeda dari password saat ini',
    path: ['newPassword'],
  })

export const setPasswordSchema = z
  .object({
    newPassword: z.string().min(8, 'Password minimal 8 karakter'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Konfirmasi password tidak cocok',
    path: ['confirmPassword'],
  })

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type CreateTenantInput = z.infer<typeof createTenantSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type SetPasswordInput = z.infer<typeof setPasswordSchema>
