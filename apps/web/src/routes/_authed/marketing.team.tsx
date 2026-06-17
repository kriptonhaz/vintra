import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listMyStaff,
  listStaffCandidates,
  addStaff,
  updateStaffAllocation,
  setStaffActive,
  getTeamSummary,
} from '@/server/functions/marketing-team'
import { getMyCodeBudget } from '@/server/functions/marketing-codes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
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
import { useToast } from '@/components/ui/toast'
import { formatRupiah } from '@/lib/currency'
import { Users, UserPlus, Wallet, Crown, Plus } from 'lucide-react'

export const Route = createFileRoute('/_authed/marketing/team')({
  // Head-only. getMyCodeBudget returns the role; staff get bounced to the
  // codes tab (the Tim tab isn't shown to them, this guards direct URLs).
  loader: async () => {
    const budget = await getMyCodeBudget().catch(() => {
      throw redirect({ to: '/dashboard' })
    })
    if (budget.role !== 'head') {
      throw redirect({ to: '/marketing' })
    }
    return {
      headCap: budget.budgetPct,
      summary: await getTeamSummary(),
      staff: await listMyStaff(),
    }
  },
  component: MarketingTeamPage,
})

type StaffRow = Awaited<ReturnType<typeof listMyStaff>>[number]

function MarketingTeamPage() {
  const initial = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: summary = initial.summary } = useQuery({
    queryKey: ['marketing', 'team-summary'],
    queryFn: () => getTeamSummary(),
    initialData: initial.summary,
    staleTime: 30_000,
  })
  const { data: staff = initial.staff } = useQuery({
    queryKey: ['marketing', 'staff'],
    queryFn: () => listMyStaff(),
    initialData: initial.staff,
    staleTime: 30_000,
  })

  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<StaffRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const { toast } = useToast()

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['marketing', 'team-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing', 'staff'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing', 'staff-candidates'] }),
    ])
    await router.invalidate()
  }

  async function handleToggle(s: StaffRow) {
    setBusyId(s.id)
    try {
      await setStaffActive({ data: { staffAgentId: s.id, isActive: !s.isActive } })
      toast({ title: s.isActive ? 'Staf dinonaktifkan' : 'Staf diaktifkan', variant: 'success' })
      await refresh()
    } catch (err) {
      toast({ title: 'Gagal mengubah', description: (err as Error).message, variant: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Jumlah Staf" value={`${summary.activeStaffCount}/${summary.staffCount}`} icon={<Users className="h-5 w-5" />} raw />
        <StatTile label="Referral Tim" value={String(summary.teamReferralCount)} icon={<UserPlus className="h-5 w-5" />} raw />
        <StatTile label="Komisi Staf" value={summary.teamStaffCommission} icon={<Wallet className="h-5 w-5" />} />
        <StatTile label="Override Saya" value={summary.headOverrideTotal} icon={<Crown className="h-5 w-5" />} highlight />
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Staf Tim Saya</CardTitle>
              <CardDescription className="mt-1">
                Atur budget tiap staf dan persentase override yang Anda terima dari
                penjualan mereka. Override + budget tidak boleh melebihi cap Anda{' '}
                ({initial.headCap.toFixed(2)}%).
              </CardDescription>
            </div>
            <Button variant="brand" className="mt-3 w-full sm:mt-0 sm:w-auto" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" />
              Tambah Staf
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0 py-0">
          {staff.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              Belum ada staf. Tambahkan anggota tim sebagai staf marketing untuk mulai
              membangun jaringan referral Anda.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead className="text-right">Budget %</TableHead>
                  <TableHead className="text-right">Override %</TableHead>
                  <TableHead className="text-right">Referral</TableHead>
                  <TableHead className="text-right">Komisi Staf</TableHead>
                  <TableHead className="text-right">Override Saya (Rp)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-28 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      {s.name}
                      {s.jobTitle && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">{s.jobTitle}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {parseFloat(s.staffBudgetPct ?? '0').toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {parseFloat(s.headOverridePct ?? '0').toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s.referralCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRupiah(parseFloat(s.staffCommission))}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-success-700 dark:text-success-400">
                      {formatRupiah(parseFloat(s.headOverrideCommission))}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                          (s.isActive
                            ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')
                        }
                      >
                        {s.isActive ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                          Alokasi
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          loading={busyId === s.id}
                          onClick={() => handleToggle(s)}
                        >
                          {s.isActive ? 'Nonaktif' : 'Aktif'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AddStaffSheet open={showAdd} headCap={initial.headCap} onClose={() => setShowAdd(false)} onSaved={async () => { setShowAdd(false); await refresh() }} />

      <Sheet open={!!editing} onClose={() => setEditing(null)}>
        <SheetHeader onClose={() => setEditing(null)}>
          <SheetTitle>Atur Alokasi Staf</SheetTitle>
          <SheetDescription>
            {editing?.name} — override + budget ≤ cap Anda ({initial.headCap.toFixed(2)}%).
          </SheetDescription>
        </SheetHeader>
        {editing && (
          <AllocationForm
            key={editing.id}
            headCap={initial.headCap}
            defaultBudget={parseFloat(editing.staffBudgetPct ?? '0').toFixed(2)}
            defaultOverride={parseFloat(editing.headOverridePct ?? '0').toFixed(2)}
            submitLabel="Simpan"
            onCancel={() => setEditing(null)}
            onSubmit={async (budget, override) => {
              await updateStaffAllocation({
                data: { staffAgentId: editing.id, staffBudgetPct: budget, headOverridePct: override },
              })
              toast({ title: 'Alokasi disimpan', variant: 'success' })
              setEditing(null)
              await refresh()
            }}
          />
        )}
      </Sheet>
    </div>
  )
}

function StatTile({
  label,
  value,
  icon,
  highlight,
  raw,
}: {
  label: string
  value: string
  icon: React.ReactNode
  highlight?: boolean
  raw?: boolean
}) {
  return (
    <Card className={highlight ? 'ring-2 ring-brand-500/40' : undefined}>
      <CardContent className="space-y-1 py-4">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="text-brand-600 dark:text-brand-400">{icon}</span>
          <span>{label}</span>
        </div>
        <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
          {raw ? value : formatRupiah(parseFloat(value))}
        </p>
      </CardContent>
    </Card>
  )
}

function AddStaffSheet({
  open,
  headCap,
  onClose,
  onSaved,
}: {
  open: boolean
  headCap: number
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const { data: candidates = [] } = useQuery({
    queryKey: ['marketing', 'staff-candidates'],
    queryFn: () => listStaffCandidates(),
    enabled: open,
    staleTime: 30_000,
  })
  const [userId, setUserId] = useState('')

  return (
    <Sheet open={open} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Tambah Staf</SheetTitle>
        <SheetDescription>
          Pilih anggota tim internal, lalu tentukan budget mereka dan override Anda.
        </SheetDescription>
      </SheetHeader>
      <AllocationForm
        headCap={headCap}
        defaultBudget={(headCap * 0.75).toFixed(2)}
        defaultOverride={(headCap * 0.25).toFixed(2)}
        submitLabel="Tambah Staf"
        onCancel={onClose}
        leading={
          <Select
            label="Anggota"
            placeholder={candidates.length ? 'Pilih anggota…' : 'Semua anggota sudah terdaftar'}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            options={candidates.map((c) => ({
              value: c.userId,
              label:
                [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
                c.jobTitle ||
                c.userId.slice(0, 8),
            }))}
          />
        }
        onSubmit={async (budget, override) => {
          if (!userId) {
            toast({ title: 'Pilih anggota dulu', variant: 'error' })
            return
          }
          await addStaff({ data: { userId, staffBudgetPct: budget, headOverridePct: override } })
          toast({ title: 'Staf ditambahkan', variant: 'success' })
          setUserId('')
          onSaved()
        }}
      />
    </Sheet>
  )
}

function AllocationForm({
  headCap,
  defaultBudget,
  defaultOverride,
  submitLabel,
  leading,
  onSubmit,
  onCancel,
}: {
  headCap: number
  defaultBudget: string
  defaultOverride: string
  submitLabel: string
  leading?: React.ReactNode
  onSubmit: (budget: string, override: string) => Promise<void>
  onCancel: () => void
}) {
  const [budget, setBudget] = useState(defaultBudget)
  const [override, setOverride] = useState(defaultOverride)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()

  const budgetNum = parseFloat(budget) || 0
  const overrideNum = parseFloat(override) || 0
  const sum = budgetNum + overrideNum
  const overCap = sum > headCap + 1e-9

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d+(\.\d{1,2})?$/.test(budget) || !/^\d+(\.\d{1,2})?$/.test(override)) {
      toast({ title: 'Persentase tidak valid', variant: 'error' })
      return
    }
    if (overCap) return
    setSaving(true)
    try {
      await onSubmit(budget, override)
    } catch (err) {
      toast({ title: 'Gagal menyimpan', description: (err as Error).message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {leading}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Budget staf (%)"
            type="number"
            step="0.01"
            min="0"
            max={headCap}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
          <Input
            label="Override saya (%)"
            type="number"
            step="0.01"
            min="0"
            max={headCap}
            value={override}
            onChange={(e) => setOverride(e.target.value)}
          />
        </div>
        <div
          className={
            'flex items-center justify-between rounded-lg border px-3 py-2 text-sm ' +
            (overCap
              ? 'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-900/40 dark:bg-danger-900/20 dark:text-danger-300'
              : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300')
          }
        >
          <span>Total budget + override</span>
          <span className="font-semibold tabular-nums">
            {sum.toFixed(2)}% / {headCap.toFixed(2)}%
          </span>
        </div>
        <p className="text-xs text-gray-500">
          Budget staf adalah pagu diskon + komisi yang bisa diatur staf di kodenya.
          Override adalah komisi yang Anda terima dari setiap penjualan staf ini.
        </p>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" variant="brand" loading={saving} disabled={overCap}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
