import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getMyCommissionSummary,
  listMyCommissions,
  listMyClaimRequests,
  getMyPayoutMethod,
  upsertPayoutMethod,
  submitClaimRequest,
} from '@/server/functions/marketing-commission'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { Wallet, Clock, CheckCircle2, CreditCard } from 'lucide-react'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_authed/marketing/commission')({
  loader: async () => ({
    summary: await getMyCommissionSummary(),
    commissions: await listMyCommissions(),
    claimRequests: await listMyClaimRequests(),
    payout: await getMyPayoutMethod(),
  }),
  component: MarketingCommissionPage,
})

type Tab = 'commissions' | 'claims' | 'bank'

function MarketingCommissionPage() {
  const initial = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('commissions')
  const [claimDialogOpen, setClaimDialogOpen] = useState(false)
  const [claimLoading, setClaimLoading] = useState(false)

  const { data: summary = initial.summary } = useQuery({
    queryKey: ['marketing', 'commission-summary'],
    queryFn: () => getMyCommissionSummary(),
    initialData: initial.summary,
    staleTime: 30_000,
  })
  const { data: commissions = initial.commissions } = useQuery({
    queryKey: ['marketing', 'commissions'],
    queryFn: () => listMyCommissions(),
    initialData: initial.commissions,
    staleTime: 30_000,
  })
  const { data: claimRequests = initial.claimRequests } = useQuery({
    queryKey: ['marketing', 'claim-requests'],
    queryFn: () => listMyClaimRequests(),
    initialData: initial.claimRequests,
    staleTime: 30_000,
  })
  const { data: payout = initial.payout } = useQuery({
    queryKey: ['marketing', 'payout-method'],
    queryFn: () => getMyPayoutMethod(),
    initialData: initial.payout,
    staleTime: 60_000,
  })

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['marketing', 'commission-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing', 'commissions'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing', 'claim-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing', 'payout-method'] }),
    ])
    await router.invalidate()
  }

  async function handleSubmitClaim() {
    setClaimLoading(true)
    try {
      const res = await submitClaimRequest()
      toast({
        title: 'Klaim diajukan',
        description: `${res.count} komisi senilai ${formatRupiah(parseFloat(res.total))} sedang diproses admin.`,
        variant: 'success',
      })
      setClaimDialogOpen(false)
      setTab('claims')
      await refresh()
    } catch (err) {
      setClaimDialogOpen(false)
      toast({
        title: 'Gagal mengajukan klaim',
        description: (err as Error).message,
        variant: 'error',
      })
    } finally {
      setClaimLoading(false)
    }
  }

  const claimable = parseFloat(summary.claimable)
  const canClaim = claimable > 0 && !!payout

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total Komisi" value={summary.totalEarned} icon={<Wallet className="h-5 w-5" />} />
        <StatTile label="Dalam Masa Klaim" value={summary.pending} icon={<Clock className="h-5 w-5" />} tooltip="Komisi tersedia diklaim setelah masa klaim selesai" />
        <StatTile label="Siap Diklaim" value={summary.claimable} icon={<CheckCircle2 className="h-5 w-5" />} highlight={claimable > 0} />
        <StatTile label="Sudah Dibayar" value={summary.paid} icon={<CreditCard className="h-5 w-5" />} />
      </div>

      {claimable > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Ada {formatRupiah(claimable)} siap diklaim
              </p>
              {!payout && (
                <p className="mt-1 text-xs text-warning-700 dark:text-warning-400">
                  Lengkapi info bank di tab Info Bank untuk mengajukan klaim.
                </p>
              )}
            </div>
            <Button variant="brand" disabled={!canClaim} onClick={() => setClaimDialogOpen(true)}>
              Ajukan Klaim
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {[
          { id: 'commissions' as const, label: 'Riwayat Komisi' },
          { id: 'claims' as const, label: 'Riwayat Klaim' },
          { id: 'bank' as const, label: 'Info Bank' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
              (tab === t.id
                ? 'border-brand-600 text-brand-700 dark:text-brand-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'commissions' && <CommissionsTable rows={commissions} />}
      {tab === 'claims' && <ClaimsTable rows={claimRequests} />}
      {tab === 'bank' && <BankInfoForm initial={payout} onSaved={refresh} />}

      <Dialog open={claimDialogOpen} onClose={() => setClaimDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajukan Klaim Komisi</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-1 py-2 text-sm text-gray-700 dark:text-gray-300">
            <p>
              Jumlah klaim: <strong>{formatRupiah(claimable)}</strong>
            </p>
            {payout && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-800">
                <p className="font-medium text-gray-900 dark:text-gray-100">{payout.bankName}</p>
                <p className="font-mono">{payout.accountNumber}</p>
                <p>a.n. {payout.accountHolderName}</p>
              </div>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Setelah diajukan, admin akan memproses dalam 1-3 hari kerja.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-1 pt-3 dark:border-gray-700">
            <Button type="button" variant="ghost" onClick={() => setClaimDialogOpen(false)}>
              Batal
            </Button>
            <Button type="button" variant="brand" loading={claimLoading} onClick={handleSubmitClaim}>
              Ajukan Klaim
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function StatTile({
  label,
  value,
  icon,
  tooltip,
  highlight,
}: {
  label: string
  value: string
  icon: React.ReactNode
  tooltip?: string
  highlight?: boolean
}) {
  return (
    <Card className={highlight ? 'ring-2 ring-brand-500/40' : undefined}>
      <CardContent className="space-y-1 py-4" title={tooltip}>
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="text-brand-600 dark:text-brand-400">{icon}</span>
          <span>{label}</span>
        </div>
        <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
          {formatRupiah(parseFloat(value))}
        </p>
      </CardContent>
    </Card>
  )
}

type CommissionRow = Awaited<ReturnType<typeof listMyCommissions>>[number]

const STATUS_LABEL: Record<CommissionRow['effectiveStatus'], { text: string; className: string }> = {
  pending: { text: 'Masa Klaim', className: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300' },
  claimable: { text: 'Siap Diklaim', className: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300' },
  submitted: { text: 'Diajukan', className: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' },
  paid: { text: 'Sudah Dibayar', className: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  reversed: { text: 'Dibatalkan', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

function CommissionsTable({ rows }: { rows: CommissionRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          Belum ada komisi. Komisi akan muncul di sini saat pendaftar dari kode Anda
          mulai berlangganan.
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="px-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal</TableHead>
              <TableHead>Dari Pendaftar</TableHead>
              <TableHead>Jenis</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const status = STATUS_LABEL[r.effectiveStatus]
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(r.createdAt, 'dd MMM yyyy')}
                  </TableCell>
                  <TableCell>{r.refereeTenantName ?? '—'}</TableCell>
                  <TableCell>
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium ' +
                        (r.kind === 'override'
                          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')
                      }
                    >
                      {r.kind === 'override' ? 'Override Tim' : 'Langsung'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + status.className}>
                      {status.text}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatRupiah(parseFloat(r.amountIdr))}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

type ClaimRow = Awaited<ReturnType<typeof listMyClaimRequests>>[number]

const CLAIM_STATUS_LABEL: Record<string, { text: string; className: string }> = {
  submitted: { text: 'Diajukan', className: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' },
  approved: { text: 'Disetujui', className: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300' },
  paid: { text: 'Sudah Dibayar', className: 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300' },
  rejected: { text: 'Ditolak', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
}

function ClaimsTable({ rows }: { rows: ClaimRow[] }) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          Belum ada riwayat klaim.
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="px-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tanggal Ajukan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Diproses</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const status = CLAIM_STATUS_LABEL[r.status] ?? CLAIM_STATUS_LABEL.submitted!
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDate(r.submittedAt, 'dd MMM yyyy HH:mm')}
                  </TableCell>
                  <TableCell>
                    <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + status.className}>
                      {status.text}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {r.processedAt ? formatDate(r.processedAt, 'dd MMM yyyy HH:mm') : '—'}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatRupiah(parseFloat(r.totalAmountIdr))}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

type PayoutMethod = Awaited<ReturnType<typeof getMyPayoutMethod>>

function BankInfoForm({ initial, onSaved }: { initial: PayoutMethod; onSaved: () => void }) {
  const [bankName, setBankName] = useState(initial?.bankName ?? '')
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? '')
  const [accountHolderName, setAccountHolderName] = useState(initial?.accountHolderName ?? '')
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await upsertPayoutMethod({ data: { bankName, accountNumber, accountHolderName } })
      toast({ title: 'Info bank disimpan', variant: 'success' })
      onSaved()
    } catch (err) {
      toast({ title: 'Gagal menyimpan', description: (err as Error).message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Info Bank</CardTitle>
        <CardDescription>
          Admin akan transfer komisi ke rekening ini setelah klaim disetujui.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="max-w-md space-y-4">
          <Input label="Nama Bank" placeholder="MISAL: BCA" value={bankName} onChange={(e) => setBankName(e.target.value)} required />
          <Input
            label="Nomor Rekening"
            placeholder="1234567890"
            inputMode="numeric"
            pattern="\d*"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
            required
          />
          <Input
            label="Nama Pemilik Rekening"
            placeholder="Sesuai buku tabungan"
            value={accountHolderName}
            onChange={(e) => setAccountHolderName(e.target.value)}
            required
          />
          <Button type="submit" variant="brand" loading={saving}>
            Simpan
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
