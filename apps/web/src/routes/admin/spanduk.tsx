import {
  useState,
  forwardRef,
  type ReactNode,
  type InputHTMLAttributes,
} from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, GripVertical, Ruler } from 'lucide-react'
import {
  listSpandukPromptFields,
  getSpandukAdminSettings,
  saveSpandukAdminSettings,
  createSpandukField,
  updateSpandukField,
  deleteSpandukField,
  createSpandukFieldOption,
  updateSpandukFieldOption,
  deleteSpandukFieldOption,
  listSpandukSizePresets,
  createSpandukSize,
  updateSpandukSize,
  deleteSpandukSize,
  type SpandukField,
  type SpandukFieldOption,
  type SpandukSizePreset,
} from '@/server/functions/admin-spanduk-fields'
import type { SpandukTextLayout, SpandukType } from '@vintra/db/schema'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/admin/spanduk')({
  loader: async () => {
    const [fields, settings, sizes] = await Promise.all([
      listSpandukPromptFields(),
      getSpandukAdminSettings(),
      listSpandukSizePresets(),
    ])
    return { fields, settings, sizes }
  },
  component: AdminSpandukPage,
})

const DEFAULT_TEXT_LAYOUT: SpandukTextLayout = {
  stripHeightPct: 0.25,
  stripBgColor: '#0b0f1a',
  stripOpacity: 0.78,
  headlineFont: 'Poppins-Bold',
  headlineColor: '#FFFFFF',
  subheadFont: 'Poppins-Regular',
  subheadColor: '#ecddb8',
  contactFont: 'Poppins-Regular',
  contactColor: '#e2e5ec',
}

const SPANDUK_TYPE_LABELS: Record<SpandukType, string> = {
  xbanner: 'X-Banner',
  spanduk: 'Spanduk',
}

function AdminSpandukPage() {
  const { fields, settings, sizes } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const { toast } = useToast()

  // Settings
  const [templateDraft, setTemplateDraft] = useState(settings.template)
  const [creditCostDraft, setCreditCostDraft] = useState(
    settings.defaultCreditCost,
  )
  const [layoutDraft, setLayoutDraft] = useState<SpandukTextLayout>(
    settings.textLayout ?? DEFAULT_TEXT_LAYOUT,
  )
  const [savingSettings, setSavingSettings] = useState(false)

  // Sheets / dialogs
  const [fieldSheet, setFieldSheet] = useState<
    { mode: 'create' } | { mode: 'edit'; field: SpandukField } | null
  >(null)
  const [deletingField, setDeletingField] = useState<SpandukField | null>(null)
  const [optionSheet, setOptionSheet] = useState<
    | { mode: 'create'; fieldId: string }
    | { mode: 'edit'; fieldId: string; option: SpandukFieldOption }
    | null
  >(null)
  const [deletingOption, setDeletingOption] =
    useState<SpandukFieldOption | null>(null)
  const [sizeSheet, setSizeSheet] = useState<
    { mode: 'create' } | { mode: 'edit'; size: SpandukSizePreset } | null
  >(null)
  const [deletingSize, setDeletingSize] = useState<SpandukSizePreset | null>(
    null,
  )
  const [confirmLoading, setConfirmLoading] = useState(false)

  async function handleSaveSettings() {
    setSavingSettings(true)
    try {
      await saveSpandukAdminSettings({
        data: {
          template: templateDraft,
          defaultCreditCost: creditCostDraft,
          textLayout: layoutDraft,
        },
      })
      toast({ title: 'Pengaturan disimpan', variant: 'success' })
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      })
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleDeleteField() {
    if (!deletingField) return
    setConfirmLoading(true)
    try {
      await deleteSpandukField({ data: { id: deletingField.id } })
      setDeletingField(null)
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      })
    } finally {
      setConfirmLoading(false)
    }
  }

  async function handleDeleteOption() {
    if (!deletingOption) return
    setConfirmLoading(true)
    try {
      await deleteSpandukFieldOption({ data: { id: deletingOption.id } })
      setDeletingOption(null)
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      })
    } finally {
      setConfirmLoading(false)
    }
  }

  async function handleDeleteSize() {
    if (!deletingSize) return
    setConfirmLoading(true)
    try {
      await deleteSpandukSize({ data: { id: deletingSize.id } })
      setDeletingSize(null)
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      })
    } finally {
      setConfirmLoading(false)
    }
  }

  // Group sizes by type for display
  const sizesByType: Record<SpandukType, SpandukSizePreset[]> = {
    xbanner: [],
    spanduk: [],
  }
  for (const s of sizes) sizesByType[s.type].push(s)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Spanduk AI — Konfigurasi
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Atur prompt template, biaya kredit, layout teks, ukuran standar, dan
          field selector yang muncul di halaman Buat Spanduk.
        </p>
      </div>

      {/* Settings */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          Pengaturan Umum
        </h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Prompt Template
            </label>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Gunakan placeholder seperti {'{theme}'}, {'{style}'}, dst. Mereka
              akan diganti dengan prompt fragment dari field yang dipilih user.
            </p>
            {fields.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {fields.map((f) => (
                  <code
                    key={f.id}
                    className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                  >
                    {`{${f.key}}`}
                  </code>
                ))}
              </div>
            )}
            <Textarea
              className="font-mono text-xs"
              rows={8}
              value={templateDraft}
              onChange={(e) => setTemplateDraft(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Biaya Kredit per Spanduk
              </label>
              <Input
                type="number"
                min={1}
                max={100}
                value={creditCostDraft}
                onChange={(e) =>
                  setCreditCostDraft(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
          </div>

          {/* Text overlay layout */}
          <details className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
            <summary className="cursor-pointer text-sm font-medium text-gray-800 dark:text-gray-200">
              Layout Teks (overlay strip)
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <LayoutNumberField
                label="Tinggi strip (0..1)"
                step={0.05}
                min={0}
                max={1}
                value={layoutDraft.stripHeightPct}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, stripHeightPct: v })
                }
              />
              <LayoutNumberField
                label="Opacity strip (0..1)"
                step={0.05}
                min={0}
                max={1}
                value={layoutDraft.stripOpacity}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, stripOpacity: v })
                }
              />
              <LayoutColorField
                label="Warna strip"
                value={layoutDraft.stripBgColor}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, stripBgColor: v })
                }
              />
              <LayoutTextField
                label="Font headline"
                value={layoutDraft.headlineFont}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, headlineFont: v })
                }
              />
              <LayoutColorField
                label="Warna headline"
                value={layoutDraft.headlineColor}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, headlineColor: v })
                }
              />
              <LayoutTextField
                label="Font subhead"
                value={layoutDraft.subheadFont}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, subheadFont: v })
                }
              />
              <LayoutColorField
                label="Warna subhead"
                value={layoutDraft.subheadColor}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, subheadColor: v })
                }
              />
              <LayoutTextField
                label="Font kontak"
                value={layoutDraft.contactFont}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, contactFont: v })
                }
              />
              <LayoutColorField
                label="Warna kontak"
                value={layoutDraft.contactColor}
                onChange={(v) =>
                  setLayoutDraft({ ...layoutDraft, contactColor: v })
                }
              />
            </div>
          </details>

          <div className="flex justify-end">
            <Button
              variant="brand"
              loading={savingSettings}
              onClick={handleSaveSettings}
            >
              Simpan Pengaturan
            </Button>
          </div>
        </div>
      </section>

      {/* Sizes */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Ukuran Standar
          </h2>
          <Button variant="brand" onClick={() => setSizeSheet({ mode: 'create' })}>
            <Plus className="h-4 w-4" />
            Tambah Ukuran
          </Button>
        </div>

        {(['xbanner', 'spanduk'] as const).map((type) => {
          const rows = sizesByType[type]
          return (
            <div
              key={type}
              className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="border-b border-gray-100 px-4 py-2.5 dark:border-gray-700">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {SPANDUK_TYPE_LABELS[type]}
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="px-4 py-3 text-xs text-gray-400">
                  Belum ada ukuran untuk tipe ini.
                </p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {rows.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Ruler className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                        <div className="min-w-0">
                          <p
                            className={cn(
                              'text-sm font-medium text-gray-800 dark:text-gray-200',
                              !s.isActive && 'text-gray-400 line-through',
                            )}
                          >
                            {s.label}
                          </p>
                          <p className="text-xs text-gray-500">
                            {s.widthCm} × {s.heightCm} cm
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <IconButton
                          onClick={() =>
                            setSizeSheet({ mode: 'edit', size: s })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton danger onClick={() => setDeletingSize(s)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* Fields */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Field Selector
          </h2>
          <Button variant="brand" onClick={() => setFieldSheet({ mode: 'create' })}>
            <Plus className="h-4 w-4" />
            Tambah Field
          </Button>
        </div>

        {fields.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-8 py-12 text-center text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
            Belum ada field. Tambah field pertama untuk muncul di Buat Spanduk.
          </div>
        ) : (
          fields.map((field) => (
            <div
              key={field.id}
              className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4 dark:border-gray-700">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {field.label}
                    </span>
                    <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {`{${field.key}}`}
                    </code>
                    <Tag tone="gray">
                      {field.fieldType === 'text' ? 'Teks' : 'Pilihan'}
                    </Tag>
                    {field.required && <Tag tone="brand">Wajib</Tag>}
                    {field.allowsCustom && <Tag tone="gray">Custom OK</Tag>}
                    {!field.isActive && <Tag tone="gray">Nonaktif</Tag>}
                  </div>
                  {field.helpText && (
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {field.helpText}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton
                    onClick={() => setFieldSheet({ mode: 'edit', field })}
                  >
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <IconButton danger onClick={() => setDeletingField(field)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>

              {field.fieldType === 'select' && (
                <>
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {field.options.map((opt) => (
                      <div
                        key={opt.id}
                        className="flex items-start justify-between gap-3 px-4 py-2.5"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" />
                          <div className="min-w-0">
                            <span
                              className={cn(
                                'text-sm font-medium text-gray-800 dark:text-gray-200',
                                !opt.isActive && 'text-gray-400 line-through',
                              )}
                            >
                              {opt.label}
                            </span>
                            <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                              {opt.promptFragment}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <IconButton
                            onClick={() =>
                              setOptionSheet({
                                mode: 'edit',
                                fieldId: field.id,
                                option: opt,
                              })
                            }
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </IconButton>
                          <IconButton
                            danger
                            onClick={() => setDeletingOption(opt)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-gray-100 p-2 dark:border-gray-700">
                    <button
                      type="button"
                      onClick={() =>
                        setOptionSheet({ mode: 'create', fieldId: field.id })
                      }
                      className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-900/20"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Tambah Pilihan
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </section>

      {fieldSheet && (
        <FieldSheet
          mode={fieldSheet.mode}
          field={fieldSheet.mode === 'edit' ? fieldSheet.field : undefined}
          onClose={() => setFieldSheet(null)}
          onSaved={async () => {
            setFieldSheet(null)
            await router.invalidate()
          }}
        />
      )}

      {optionSheet && (
        <OptionSheet
          mode={optionSheet.mode}
          fieldId={optionSheet.fieldId}
          option={optionSheet.mode === 'edit' ? optionSheet.option : undefined}
          onClose={() => setOptionSheet(null)}
          onSaved={async () => {
            setOptionSheet(null)
            await router.invalidate()
          }}
        />
      )}

      {sizeSheet && (
        <SizeSheet
          mode={sizeSheet.mode}
          size={sizeSheet.mode === 'edit' ? sizeSheet.size : undefined}
          onClose={() => setSizeSheet(null)}
          onSaved={async () => {
            setSizeSheet(null)
            await router.invalidate()
          }}
        />
      )}

      <ConfirmDialog
        open={deletingField !== null}
        onConfirm={handleDeleteField}
        onCancel={() => setDeletingField(null)}
        title="Hapus Field?"
        description={`Field "${deletingField?.label ?? ''}" dan semua pilihannya akan dihapus.`}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loading={confirmLoading}
        variant="danger"
      />
      <ConfirmDialog
        open={deletingOption !== null}
        onConfirm={handleDeleteOption}
        onCancel={() => setDeletingOption(null)}
        title="Hapus Pilihan?"
        description={`Pilihan "${deletingOption?.label ?? ''}" akan dihapus.`}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loading={confirmLoading}
        variant="danger"
      />
      <ConfirmDialog
        open={deletingSize !== null}
        onConfirm={handleDeleteSize}
        onCancel={() => setDeletingSize(null)}
        title="Hapus Ukuran?"
        description={`Ukuran "${deletingSize?.label ?? ''}" akan dihapus.`}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loading={confirmLoading}
        variant="danger"
      />
    </div>
  )
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function Tag({
  tone,
  children,
}: {
  tone: 'brand' | 'gray'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'brand'
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
      )}
    >
      {children}
    </span>
  )
}

function IconButton({
  children,
  onClick,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg p-1.5 text-gray-400',
        danger
          ? 'hover:bg-danger-50 hover:text-danger-600 dark:hover:bg-danger-900/30'
          : 'hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700',
      )}
    >
      {children}
    </button>
  )
}

function LayoutNumberField({
  label,
  value,
  onChange,
  ...rest
}: {
  label: string
  value: number
  onChange: (v: number) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        {...rest}
      />
    </div>
  )
}

function LayoutColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-9 w-12 cursor-pointer rounded border border-gray-300 dark:border-gray-600"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  )
}

function LayoutTextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

// ─── Field sheet ──────────────────────────────────────────────────────────────

const fieldFormSchema = z.object({
  key: z
    .string()
    .min(1, 'Key wajib diisi')
    .regex(/^[a-z][a-z0-9_]*$/, 'Huruf kecil, angka, garis bawah'),
  label: z.string().min(1, 'Label wajib diisi'),
  helpText: z.string(),
  fieldType: z.enum(['select', 'text']),
  allowsCustom: z.boolean(),
  required: z.boolean(),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
})
type FieldFormValues = z.infer<typeof fieldFormSchema>

function FieldSheet({
  mode,
  field,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  field?: SpandukField
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<FieldFormValues>({
    resolver: zodResolver(fieldFormSchema),
    defaultValues: {
      key: field?.key ?? '',
      label: field?.label ?? '',
      helpText: field?.helpText ?? '',
      fieldType: field?.fieldType ?? 'select',
      allowsCustom: field?.allowsCustom ?? false,
      required: field?.required ?? false,
      sortOrder: field?.sortOrder ?? 0,
      isActive: field?.isActive ?? true,
    },
  })

  async function onSubmit(values: FieldFormValues) {
    setServerError(null)
    try {
      const payload = { ...values, helpText: values.helpText || undefined }
      if (mode === 'create') {
        await createSpandukField({ data: payload })
      } else if (field) {
        await updateSpandukField({ data: { ...payload, id: field.id } })
      }
      await onSaved()
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : t('common.toastFailedTitle'),
      )
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {mode === 'create' ? 'Tambah Field' : 'Edit Field'}
        </SheetTitle>
        <SheetDescription>
          Field ini akan muncul sebagai input di halaman Buat Spanduk.
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Field label="Key" error={form.formState.errors.key?.message}>
            <Input {...form.register('key')} placeholder="theme" />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Placeholder pada prompt template ditulis sebagai {'{key}'}.
            </p>
          </Field>
          <Field label="Label" error={form.formState.errors.label?.message}>
            <Input {...form.register('label')} placeholder="Tema Spanduk" />
          </Field>
          <Field label="Bantuan (opsional)">
            <Input {...form.register('helpText')} />
          </Field>
          <Field label="Tipe Field">
            <select
              {...form.register('fieldType')}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="select">Pilihan (dropdown)</option>
              <option value="text">Teks bebas</option>
            </select>
          </Field>
          <Field label="Sort Order">
            <Input
              type="number"
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
          </Field>
          <Checkbox
            label="Boleh isi pilihan custom"
            {...form.register('allowsCustom')}
          />
          <Checkbox label="Wajib diisi" {...form.register('required')} />
          <Checkbox label="Aktif" {...form.register('isActive')} />
          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={form.formState.isSubmitting}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

// ─── Option sheet ─────────────────────────────────────────────────────────────

const optionFormSchema = z.object({
  label: z.string().min(1, 'Label wajib diisi'),
  promptFragment: z.string().min(1, 'Fragmen prompt wajib diisi'),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
})
type OptionFormValues = z.infer<typeof optionFormSchema>

function OptionSheet({
  mode,
  fieldId,
  option,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  fieldId: string
  option?: SpandukFieldOption
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<OptionFormValues>({
    resolver: zodResolver(optionFormSchema),
    defaultValues: {
      label: option?.label ?? '',
      promptFragment: option?.promptFragment ?? '',
      sortOrder: option?.sortOrder ?? 0,
      isActive: option?.isActive ?? true,
    },
  })

  async function onSubmit(values: OptionFormValues) {
    setServerError(null)
    try {
      if (mode === 'create') {
        await createSpandukFieldOption({ data: { ...values, fieldId } })
      } else if (option) {
        await updateSpandukFieldOption({ data: { ...values, id: option.id } })
      }
      await onSaved()
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : t('common.toastFailedTitle'),
      )
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {mode === 'create' ? 'Tambah Pilihan' : 'Edit Pilihan'}
        </SheetTitle>
        <SheetDescription>
          Pilihan yang muncul di dropdown — fragmen prompt-nya akan disisipkan
          ke template.
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Field label="Label" error={form.formState.errors.label?.message}>
            <Input {...form.register('label')} placeholder="Modern / Minimalis" />
          </Field>
          <Field
            label="Fragmen Prompt"
            error={form.formState.errors.promptFragment?.message}
          >
            <Textarea rows={4} {...form.register('promptFragment')} />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Akan disisipkan ke prompt template menggantikan {'{key}'} field
              ini.
            </p>
          </Field>
          <Field label="Sort Order">
            <Input
              type="number"
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
          </Field>
          <Checkbox label="Aktif" {...form.register('isActive')} />
          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={form.formState.isSubmitting}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

// ─── Size sheet ───────────────────────────────────────────────────────────────

const sizeFormSchema = z.object({
  type: z.enum(['xbanner', 'spanduk']),
  label: z.string().min(1, 'Label wajib diisi'),
  widthCm: z.number().int().min(10, 'Min 10 cm').max(2000, 'Maks 20 m'),
  heightCm: z.number().int().min(10, 'Min 10 cm').max(2000, 'Maks 20 m'),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
})
type SizeFormValues = z.infer<typeof sizeFormSchema>

function SizeSheet({
  mode,
  size,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit'
  size?: SpandukSizePreset
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<SizeFormValues>({
    resolver: zodResolver(sizeFormSchema),
    defaultValues: {
      type: size?.type ?? 'spanduk',
      label: size?.label ?? '',
      widthCm: size?.widthCm ?? 300,
      heightCm: size?.heightCm ?? 100,
      sortOrder: size?.sortOrder ?? 0,
      isActive: size?.isActive ?? true,
    },
  })

  async function onSubmit(values: SizeFormValues) {
    setServerError(null)
    try {
      if (mode === 'create') {
        await createSpandukSize({ data: values })
      } else if (size) {
        await updateSpandukSize({ data: { ...values, id: size.id } })
      }
      await onSaved()
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : t('common.toastFailedTitle'),
      )
    }
  }

  return (
    <Sheet open onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {mode === 'create' ? 'Tambah Ukuran' : 'Edit Ukuran'}
        </SheetTitle>
        <SheetDescription>
          Ukuran standar yang muncul di dropdown di halaman Buat Spanduk.
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Field label="Tipe Spanduk">
            <select
              {...form.register('type')}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="xbanner">X-Banner</option>
              <option value="spanduk">Spanduk</option>
            </select>
          </Field>
          <Field label="Label" error={form.formState.errors.label?.message}>
            <Input
              {...form.register('label')}
              placeholder="Spanduk 1×3 m"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Lebar (cm)"
              error={form.formState.errors.widthCm?.message}
            >
              <Input
                type="number"
                {...form.register('widthCm', { valueAsNumber: true })}
              />
            </Field>
            <Field
              label="Tinggi (cm)"
              error={form.formState.errors.heightCm?.message}
            >
              <Input
                type="number"
                {...form.register('heightCm', { valueAsNumber: true })}
              />
            </Field>
          </div>
          <Field label="Sort Order">
            <Input
              type="number"
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
          </Field>
          <Checkbox label="Aktif" {...form.register('isActive')} />
          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            variant="brand"
            loading={form.formState.isSubmitting}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  )
}

const Checkbox = forwardRef<
  HTMLInputElement,
  { label: string } & InputHTMLAttributes<HTMLInputElement>
>(function Checkbox({ label, ...props }, ref) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
      <input
        ref={ref}
        type="checkbox"
        className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
        {...props}
      />
      {label}
    </label>
  )
})
