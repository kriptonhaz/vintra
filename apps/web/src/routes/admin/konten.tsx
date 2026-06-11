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
import { Plus, Pencil, Trash2, GripVertical } from 'lucide-react'
import {
  listKontenPromptFields,
  getKontenTemplate,
  saveKontenTemplate,
  createKontenField,
  updateKontenField,
  deleteKontenField,
  createKontenFieldOption,
  updateKontenFieldOption,
  deleteKontenFieldOption,
  type KontenField,
  type KontenFieldOption,
} from '@/server/functions/admin-konten-fields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/admin/konten')({
  loader: async () => {
    const [fields, template] = await Promise.all([
      listKontenPromptFields(),
      getKontenTemplate(),
    ])
    return { fields, template: template.template }
  },
  component: AdminKontenPage,
})

function AdminKontenPage() {
  const { fields, template } = Route.useLoaderData()
  const router = useRouter()
  const { t } = useTranslation()
  const { toast } = useToast()

  const [templateDraft, setTemplateDraft] = useState(template)
  const [savingTemplate, setSavingTemplate] = useState(false)

  const [fieldSheet, setFieldSheet] = useState<
    { mode: 'create' } | { mode: 'edit'; field: KontenField } | null
  >(null)
  const [deletingField, setDeletingField] = useState<KontenField | null>(null)
  const [optionSheet, setOptionSheet] = useState<
    | { mode: 'create'; fieldId: string }
    | { mode: 'edit'; fieldId: string; option: KontenFieldOption }
    | null
  >(null)
  const [deletingOption, setDeletingOption] = useState<KontenFieldOption | null>(
    null,
  )
  const [confirmLoading, setConfirmLoading] = useState(false)

  async function handleSaveTemplate() {
    setSavingTemplate(true)
    try {
      await saveKontenTemplate({ data: { template: templateDraft } })
      toast({ title: t('admin.konten.templateSaved'), variant: 'success' })
      await router.invalidate()
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : '',
        variant: 'error',
      })
    } finally {
      setSavingTemplate(false)
    }
  }

  async function handleDeleteField() {
    if (!deletingField) return
    setConfirmLoading(true)
    try {
      await deleteKontenField({ data: { id: deletingField.id } })
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
      await deleteKontenFieldOption({ data: { id: deletingOption.id } })
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('admin.konten.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.konten.subtitle')}
        </p>
      </div>

      {/* Prompt template */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('admin.konten.templateTitle')}
        </h2>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t('admin.konten.templateHint')}
        </p>
        {fields.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
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
          className="mt-3 font-mono text-xs"
          rows={5}
          value={templateDraft}
          onChange={(e) => setTemplateDraft(e.target.value)}
        />
        <div className="mt-3 flex justify-end">
          <Button
            variant="brand"
            loading={savingTemplate}
            onClick={handleSaveTemplate}
          >
            {t('common.save')}
          </Button>
        </div>
      </section>

      {/* Fields */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('admin.konten.fieldsTitle')}
          </h2>
          <Button variant="brand" onClick={() => setFieldSheet({ mode: 'create' })}>
            <Plus className="h-4 w-4" />
            {t('admin.konten.addField')}
          </Button>
        </div>

        {fields.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 bg-white px-8 py-12 text-center text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400">
            {t('admin.konten.noFields')}
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
                    {field.required && (
                      <Tag tone="brand">{t('admin.konten.tagRequired')}</Tag>
                    )}
                    {field.allowsCustom && (
                      <Tag tone="gray">{t('admin.konten.tagCustom')}</Tag>
                    )}
                    {!field.isActive && (
                      <Tag tone="gray">{t('admin.konten.tagInactive')}</Tag>
                    )}
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
                      <IconButton danger onClick={() => setDeletingOption(opt)}>
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
                  {t('admin.konten.addOption')}
                </button>
              </div>
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

      <ConfirmDialog
        open={deletingField !== null}
        onConfirm={handleDeleteField}
        onCancel={() => setDeletingField(null)}
        title={t('admin.konten.deleteFieldTitle')}
        description={t('admin.konten.deleteFieldDesc', {
          name: deletingField?.label ?? '',
        })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loading={confirmLoading}
        variant="danger"
      />
      <ConfirmDialog
        open={deletingOption !== null}
        onConfirm={handleDeleteOption}
        onCancel={() => setDeletingOption(null)}
        title={t('admin.konten.deleteOptionTitle')}
        description={t('admin.konten.deleteOptionDesc', {
          name: deletingOption?.label ?? '',
        })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        loading={confirmLoading}
        variant="danger"
      />
    </div>
  )
}

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

// ─── Field sheet ──────────────────────────────────────────────────────────────

const fieldFormSchema = z.object({
  key: z
    .string()
    .min(1, 'Key wajib diisi')
    .regex(/^[a-z][a-z0-9_]*$/, 'Huruf kecil, angka, garis bawah'),
  label: z.string().min(1, 'Label wajib diisi'),
  helpText: z.string(),
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
  field?: KontenField
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
        await createKontenField({ data: payload })
      } else if (field) {
        await updateKontenField({ data: { ...payload, id: field.id } })
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
          {mode === 'create'
            ? t('admin.konten.fieldSheetCreate')
            : t('admin.konten.fieldSheetEdit')}
        </SheetTitle>
        <SheetDescription>{t('admin.konten.fieldSheetDesc')}</SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Field label={t('admin.konten.fieldKey')} error={form.formState.errors.key?.message}>
            <Input {...form.register('key')} placeholder="target_market" />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.konten.fieldKeyHint')}
            </p>
          </Field>
          <Field label={t('admin.konten.fieldLabel')} error={form.formState.errors.label?.message}>
            <Input {...form.register('label')} placeholder="Target Pasar" />
          </Field>
          <Field label={t('admin.konten.fieldHelp')}>
            <Input {...form.register('helpText')} />
          </Field>
          <Field label={t('admin.konten.fieldSort')}>
            <Input
              type="number"
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
          </Field>
          <Checkbox
            label={t('admin.konten.fieldAllowsCustom')}
            {...form.register('allowsCustom')}
          />
          <Checkbox
            label={t('admin.konten.fieldRequiredFlag')}
            {...form.register('required')}
          />
          <Checkbox
            label={t('admin.konten.fieldActive')}
            {...form.register('isActive')}
          />
          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={form.formState.isSubmitting}>
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
  option?: KontenFieldOption
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
        await createKontenFieldOption({ data: { ...values, fieldId } })
      } else if (option) {
        await updateKontenFieldOption({ data: { ...values, id: option.id } })
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
          {mode === 'create'
            ? t('admin.konten.optionSheetCreate')
            : t('admin.konten.optionSheetEdit')}
        </SheetTitle>
        <SheetDescription>{t('admin.konten.optionSheetDesc')}</SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <Field label={t('admin.konten.optionLabel')} error={form.formState.errors.label?.message}>
            <Input {...form.register('label')} placeholder="Anak Muda / Gen Z" />
          </Field>
          <Field
            label={t('admin.konten.optionFragment')}
            error={form.formState.errors.promptFragment?.message}
          >
            <Textarea rows={4} {...form.register('promptFragment')} />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.konten.optionFragmentHint')}
            </p>
          </Field>
          <Field label={t('admin.konten.fieldSort')}>
            <Input
              type="number"
              {...form.register('sortOrder', { valueAsNumber: true })}
            />
          </Field>
          <Checkbox
            label={t('admin.konten.fieldActive')}
            {...form.register('isActive')}
          />
          {serverError && (
            <p className="text-sm text-danger-600">{serverError}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="brand" loading={form.formState.isSubmitting}>
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
