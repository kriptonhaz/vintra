/**
 * Customer create/edit form (JUR-6). Uses the project's Sheet pattern
 * — sticky footer with action buttons, scrollable body. Mobile-friendly
 * via the underlying Sheet implementation (which already converts to a
 * full-height drawer on small screens).
 */
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const schema = z.object({
  name: z.string().min(1, 'Nama wajib diisi').max(200),
  phone: z.string().max(40).optional(),
  email: z
    .string()
    .max(200)
    .optional()
    .or(z.literal(''))
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Email tidak valid',
    ),
  notes: z.string().max(1000).optional(),
})
type FormValues = z.infer<typeof schema>

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (values: {
    id?: string
    name: string
    phone?: string | null
    email?: string | null
    notes?: string | null
  }) => void
  loading: boolean
  /** When set, the form renders in edit mode and pre-fills. */
  initial?: {
    id: string
    name: string
    phone: string | null
    email: string | null
    notes: string | null
  }
}

export function CustomerFormSheet({
  open,
  onClose,
  onSubmit,
  loading,
  initial,
}: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      phone: initial?.phone ?? '',
      email: initial?.email ?? '',
      notes: initial?.notes ?? '',
    },
  })

  // Reset whenever the sheet opens with a (new) target — handles both
  // create-after-edit and edit-different-customer flows.
  useEffect(() => {
    if (open) {
      form.reset({
        name: initial?.name ?? '',
        phone: initial?.phone ?? '',
        email: initial?.email ?? '',
        notes: initial?.notes ?? '',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id])

  function handleSubmit(values: FormValues) {
    onSubmit({
      id: initial?.id,
      name: values.name.trim(),
      phone: values.phone?.trim() || null,
      email: values.email?.trim() || null,
      notes: values.notes?.trim() || null,
    })
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {initial ? 'Edit Pelanggan' : 'Tambah Pelanggan'}
        </SheetTitle>
        <SheetDescription>
          Database pelanggan untuk lookup cepat saat penjualan + dasar
          loyalty/promo codes nanti.
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Nama *
            </label>
            <Input
              {...form.register('name')}
              placeholder="mis. Bu Tini"
              error={form.formState.errors.name?.message}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Nomor HP / WhatsApp
            </label>
            <Input
              {...form.register('phone')}
              placeholder="08123456789"
              type="tel"
              inputMode="tel"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Disimpan otomatis dalam format internasional (62…). Pakai
              nomor HP buat lookup cepat di kasir.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Email
            </label>
            <Input
              {...form.register('email')}
              placeholder="butini@example.com"
              type="email"
              inputMode="email"
              error={form.formState.errors.email?.message}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Catatan
            </label>
            <textarea
              {...form.register('notes')}
              rows={3}
              placeholder="mis. preferensi, alergi, alamat tambahan…"
              className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/25 dark:border-gray-700 dark:bg-gray-800"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Batal
          </Button>
          <Button type="submit" variant="brand" loading={loading}>
            Simpan
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
