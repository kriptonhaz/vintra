import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { getReferralConfig, updateReferralConfig } from '@/server/functions/admin-referral-config'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import i18n from '@/lib/i18n' // JUR-140

export const Route = createFileRoute('/admin/referrals/config')({
  loader: async () => ({ config: await getReferralConfig() }),
  component: ReferralConfigPage,
})

const schema = z.object({
  capPct: z.string().regex(/^\d+(\.\d{1,2})?$/, i18n.t('admin.referralConfig.errorCapPct')),
  defaultWindowMonths: z.coerce.number().int().min(1).max(60),
  clawbackDays: z.coerce.number().int().min(1).max(365),
})
type FormValues = z.infer<typeof schema>

function ReferralConfigPage() {
  const { t } = useTranslation()
  const { config } = Route.useLoaderData()
  const router = useRouter()
  const { toast } = useToast()
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      capPct: config?.capPct ?? '20.00',
      defaultWindowMonths: config?.defaultWindowMonths ?? 12,
      clawbackDays: config?.clawbackDays ?? 14,
    },
  })

  const onSubmit = async (data: FormValues) => {
    await updateReferralConfig({ data })
    toast({ title: t('admin.referralConfig.savedToast') })
    router.invalidate()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('admin.referralConfig.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.referralConfig.subtitle')}
        </p>
        {config?.updatedAt && (
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {t('admin.referralConfig.lastUpdatedTpl', {
              date: formatDate(config.updatedAt, 'dd MMM yyyy HH:mm'),
            })}
          </p>
        )}
      </div>

      <Card className="p-6">
        <form onSubmit={handleSubmit(onSubmit)} className="max-w-sm space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.referralConfig.labelCapPct')}
            </label>
            <Input type="number" step="0.01" min="0" max="100" {...register('capPct')} />
            {errors.capPct && <p className="text-xs text-red-500">{errors.capPct.message}</p>}
            <p className="text-xs text-gray-500">{t('admin.referralConfig.helpCapPct')}</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.referralConfig.labelWindow')}
            </label>
            <Input type="number" {...register('defaultWindowMonths')} />
            {errors.defaultWindowMonths && (
              <p className="text-xs text-red-500">{errors.defaultWindowMonths.message}</p>
            )}
            <p className="text-xs text-gray-500">{t('admin.referralConfig.helpWindow')}</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.referralConfig.labelClawback')}
            </label>
            <Input type="number" {...register('clawbackDays')} />
            {errors.clawbackDays && (
              <p className="text-xs text-red-500">{errors.clawbackDays.message}</p>
            )}
            <p className="text-xs text-gray-500">{t('admin.referralConfig.helpClawback')}</p>
          </div>
          <Button type="submit" variant="brand" loading={isSubmitting}>
            {t('admin.referralConfig.submit')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
