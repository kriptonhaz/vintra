import { useState, useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Search, Coins, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  listKontenCredits,
  topUpKontenCredits,
  getKontenCreditLedger,
  type KontenCreditRow,
  type KontenLedgerEntry,
} from '@/server/functions/admin-konten-credits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/admin/konten-credits')({
  loader: () => listKontenCredits({ data: { page: 1, pageSize: 25 } }),
  component: KontenCreditsPage,
})

function KontenCreditsPage() {
  const initialData = Route.useLoaderData()
  const { t } = useTranslation()
  const { toast } = useToast()

  const [data, setData] = useState(initialData)
  const [search, setSearch] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [topUp, setTopUp] = useState<KontenCreditRow | null>(null)

  async function loadPage(nextPage: number, currentSearch: string) {
    setRefreshing(true)
    try {
      const res = await listKontenCredits({
        data: {
          page: nextPage,
          pageSize: 25,
          search: currentSearch || undefined,
        },
      })
      setData(res)
    } catch (err) {
      toast({
        title: t('common.toastFailedTitle'),
        description: err instanceof Error ? err.message : 'Gagal memuat',
        variant: 'error',
      })
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadPage(1, search)
    }, 400)
    return () => clearTimeout(timer)
  }, [search])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('admin.kontenCredits.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('admin.kontenCredits.subtitle')}
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <Search className="h-4 w-4 text-gray-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.kontenCredits.search')}
          className="border-0 shadow-none focus-visible:ring-0"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('admin.kontenCredits.colTenant')}</TableHead>
              <TableHead>{t('admin.kontenCredits.colBalance')}</TableHead>
              <TableHead className="w-32 text-right">
                {t('admin.kontenCredits.colActions')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {refreshing ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {t('common.loading')}
                </TableCell>
              </TableRow>
            ) : data.rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  {t('admin.kontenCredits.noResults')}
                </TableCell>
              </TableRow>
            ) : (
              data.rows.map((row) => (
                <TableRow key={row.tenantId}>
                  <TableCell>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {row.businessName}
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {row.slug}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums',
                        row.balance > 0
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
                      )}
                    >
                      <Coins className="h-3.5 w-3.5" />
                      {row.balance}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        className="h-8 px-3 text-xs"
                        onClick={() => setTopUp(row)}
                      >
                        {t('admin.kontenCredits.topUpCta')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-3 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('records.paginationHint', {
              page: data.page,
              totalPages: data.totalPages,
            })}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={data.page <= 1 || refreshing}
              onClick={() => loadPage(data.page - 1, search)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-xs font-medium text-gray-600 dark:text-gray-400 tabular-nums">
              {data.page} / {data.totalPages}
            </span>
            <button
              type="button"
              disabled={data.page >= data.totalPages || refreshing}
              onClick={() => loadPage(data.page + 1, search)}
              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {topUp && (
        <TopUpSheet
          tenant={topUp}
          onClose={() => setTopUp(null)}
          onSaved={async () => {
            setTopUp(null)
            await loadPage(data.page, search)
          }}
        />
      )}
    </div>
  )
}

// ─── Top-up sheet ─────────────────────────────────────────────────────────────

const formSchema = z.object({
  amount: z
    .number({ message: 'Jumlah kredit wajib diisi' })
    .int('Jumlah kredit harus bilangan bulat')
    .positive('Jumlah kredit harus lebih dari 0'),
  note: z.string().max(500).optional(),
})
type FormValues = z.infer<typeof formSchema>

function TopUpSheet({
  tenant,
  onClose,
  onSaved,
}: {
  tenant: KontenCreditRow
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [ledger, setLedger] = useState<KontenLedgerEntry[]>([])
  const [serverError, setServerError] = useState<string | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { note: '' },
  })

  useEffect(() => {
    void getKontenCreditLedger({ data: { tenantId: tenant.tenantId } })
      .then(setLedger)
      .catch(() => setLedger([]))
  }, [tenant.tenantId])

  async function onSubmit(values: FormValues) {
    setServerError(null)
    try {
      const res = await topUpKontenCredits({
        data: {
          tenantId: tenant.tenantId,
          amount: values.amount,
          note: values.note || undefined,
        },
      })
      toast({
        title: t('admin.kontenCredits.topUpSuccessTitle'),
        description: t('admin.kontenCredits.topUpSuccessDesc', {
          amount: values.amount,
          balance: res.balance,
        }),
        variant: 'success',
      })
      await onSaved()
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : t('admin.kontenCredits.topUpError'),
      )
    }
  }

  return (
    <Sheet open={true} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>
          {t('admin.kontenCredits.topUpTitle', { name: tenant.businessName })}
        </SheetTitle>
        <SheetDescription>
          {t('admin.kontenCredits.topUpDesc')}
        </SheetDescription>
      </SheetHeader>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/30">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('admin.kontenCredits.currentBalance')}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-lg font-bold text-gray-900 dark:text-gray-100">
              <Coins className="h-4 w-4 text-brand-600" />
              {tenant.balance}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.kontenCredits.fieldAmount')}
            </label>
            <Input
              {...form.register('amount', { valueAsNumber: true })}
              type="number"
              inputMode="numeric"
              min={1}
              placeholder="50"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('admin.kontenCredits.fieldAmountHint')}
            </p>
            {form.formState.errors.amount && (
              <p className="mt-1 text-xs text-danger-600">
                {form.formState.errors.amount.message}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('admin.kontenCredits.fieldNote')}
            </label>
            <Input
              {...form.register('note')}
              placeholder={t('admin.kontenCredits.fieldNotePlaceholder')}
            />
          </div>

          {ledger.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('admin.kontenCredits.historyTitle')}
              </p>
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700 dark:border-gray-700">
                {ledger.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="text-gray-700 dark:text-gray-300">
                        {t(`admin.kontenCredits.ledgerType_${entry.type}`, {
                          defaultValue: entry.type,
                        })}
                        {entry.note ? ` — ${entry.note}` : ''}
                      </p>
                      <p className="text-gray-400">
                        {formatDate(entry.createdAt, 'dd MMM yyyy HH:mm')}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 font-semibold tabular-nums',
                        entry.delta >= 0
                          ? 'text-success-600 dark:text-success-400'
                          : 'text-danger-600',
                      )}
                    >
                      {entry.delta >= 0 ? '+' : ''}
                      {entry.delta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
            {t('admin.kontenCredits.topUpCta')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
