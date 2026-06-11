import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Pencil, CheckCircle, XCircle } from 'lucide-react'
import { listWaPlans, updateWaPlan, type WaPlan } from '@/server/functions/admin-wa-plans'
import { formatNumberID } from '@/lib/utils' // JUR-137
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import i18n from '@/lib/i18n' // JUR-140

export const Route = createFileRoute('/admin/wa-plans')({
  loader: async () => ({ plans: await listWaPlans() }),
  component: WaPlansPage,
})

const formSchema = z.object({
  displayName: z.string().min(1),
  priceIdr: z.number().int().positive(),
  maxInstances: z.number().int().positive(),
  maxMonthlyReplies: z.number().int().positive(),
  ragScope: z.enum(['stock', 'full']),
  isActive: z.boolean(),
})
type FormValues = z.infer<typeof formSchema>

function WaPlansPage() {
  const { t } = useTranslation()
  const { plans } = Route.useLoaderData()
  const router = useRouter()
  const [editing, setEditing] = useState<WaPlan | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('admin.waPlans.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.waPlans.subtitle')}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.waPlans.colPlan')}</TableHead>
              <TableHead>{t('admin.waPlans.colPrice')}</TableHead>
              <TableHead>{t('admin.waPlans.colMaxInstances')}</TableHead>
              <TableHead>{t('admin.waPlans.colMaxReplies')}</TableHead>
              <TableHead>{t('admin.waPlans.colRagScope')}</TableHead>
              <TableHead>{t('admin.waPlans.colStatus')}</TableHead>
              <TableHead className="w-16 text-right">{t('admin.waPlans.colActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.planKey}>
                <TableCell>
                  <span className="font-semibold capitalize text-gray-900 dark:text-gray-100">
                    {plan.displayName}
                  </span>
                  <span className="ml-2 text-xs text-gray-400">({plan.planKey})</span>
                </TableCell>
                <TableCell>Rp {formatNumberID(Number(plan.priceIdr))}</TableCell>
                <TableCell>{plan.maxInstances}</TableCell>
                <TableCell>{formatNumberID(plan.maxMonthlyReplies)}</TableCell>
                <TableCell>
                  <span className={cn(
                    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                    plan.ragScope === 'full'
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                  )}>
                    {plan.ragScope === 'full'
                      ? t('admin.waPlans.ragFull')
                      : t('admin.waPlans.ragStock')}
                  </span>
                </TableCell>
                <TableCell>
                  {plan.isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-success-600 dark:text-success-400">
                      <CheckCircle className="h-3.5 w-3.5" /> {t('admin.waPlans.statusActive')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400">
                      <XCircle className="h-3.5 w-3.5" /> {t('admin.waPlans.statusInactive')}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => setEditing(plan)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {editing && (
        <PlanSheet
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await router.invalidate() }}
        />
      )}
    </div>
  )
}

function PlanSheet({ plan, onClose, onSaved }: {
  plan: WaPlan
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      displayName: plan.displayName,
      priceIdr: Number(plan.priceIdr),
      maxInstances: plan.maxInstances,
      maxMonthlyReplies: plan.maxMonthlyReplies,
      ragScope: plan.ragScope as 'stock' | 'full',
      isActive: plan.isActive,
    },
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      await updateWaPlan({ data: { planKey: plan.planKey, ...values } })
      await onSaved()
    } catch (err) {
      setServerError(err instanceof Error ? err.message : i18n.t('admin.waPlans.saveError'))
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>{t('admin.waPlans.sheetTitleTpl', { name: plan.displayName })}</SheetTitle>
        <SheetDescription>{t('admin.waPlans.sheetDescription')}</SheetDescription>
      </SheetHeader>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.waPlans.labelDisplayName')}
            </label>
            <Input {...form.register('displayName')} />
            {form.formState.errors.displayName && (
              <p className="mt-1 text-xs text-danger-600">{form.formState.errors.displayName.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.waPlans.labelPrice')}
            </label>
            <Input type="number" min={0} {...form.register('priceIdr', { valueAsNumber: true })} />
            {form.formState.errors.priceIdr && (
              <p className="mt-1 text-xs text-danger-600">{form.formState.errors.priceIdr.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.waPlans.labelMaxInstances')}
            </label>
            <Input type="number" min={1} {...form.register('maxInstances', { valueAsNumber: true })} />
            {form.formState.errors.maxInstances && (
              <p className="mt-1 text-xs text-danger-600">{form.formState.errors.maxInstances.message}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.waPlans.labelMaxReplies')}
            </label>
            <Input type="number" min={1} {...form.register('maxMonthlyReplies', { valueAsNumber: true })} />
            {form.formState.errors.maxMonthlyReplies && (
              <p className="mt-1 text-xs text-danger-600">{form.formState.errors.maxMonthlyReplies.message}</p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.waPlans.labelRagScope')}
            </label>
            <Controller
              control={form.control}
              name="ragScope"
              render={({ field }) => (
                <div className="flex gap-3">
                  {(['stock', 'full'] as const).map((scope) => (
                    <label key={scope} className={cn(
                      'flex flex-1 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                      field.value === scope
                        ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-900/20 dark:text-brand-400'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400',
                    )}>
                      <input type="radio" className="sr-only" checked={field.value === scope} onChange={() => field.onChange(scope)} />
                      <span className="font-medium">
                        {scope === 'full' ? t('admin.waPlans.ragFull') : t('admin.waPlans.ragStock')}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.waPlans.labelIsActive')}
            </p>
            <Controller
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <button
                  type="button"
                  role="switch"
                  aria-checked={field.value}
                  onClick={() => field.onChange(!field.value)}
                  className={cn(
                    'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                    field.value ? 'bg-brand-600 dark:bg-brand-500' : 'bg-gray-200 dark:bg-gray-700',
                  )}
                >
                  <span className={cn(
                    'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
                    field.value ? 'translate-x-6' : 'translate-x-1',
                  )} />
                </button>
              )}
            />
          </div>

          {serverError && <p className="text-sm text-danger-600">{serverError}</p>}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button type="button" variant="ghost" onClick={onClose}>{t('admin.waPlans.cancel')}</Button>
          <Button type="submit" variant="brand" loading={form.formState.isSubmitting}>
            {t('admin.waPlans.save')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
