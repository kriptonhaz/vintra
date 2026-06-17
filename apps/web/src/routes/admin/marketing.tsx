import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getMarketingConfig,
  updateMarketingConfig,
  listInternalTenants,
  searchTenantsForInternal,
  setTenantInternal,
  listEnrollableHeadCandidates,
  enrollHead,
  updateHeadCap,
  setAgentActive,
  listAgents,
} from '@/server/functions/admin-marketing'
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
import { Search } from 'lucide-react'

export const Route = createFileRoute('/admin/marketing')({
  loader: async () => ({
    config: await getMarketingConfig(),
    internalTenants: await listInternalTenants(),
    agents: await listAgents(),
  }),
  component: AdminMarketingPage,
})

type Agent = Awaited<ReturnType<typeof listAgents>>[number]

function AdminMarketingPage() {
  const initial = Route.useLoaderData()
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: config = initial.config } = useQuery({
    queryKey: ['admin', 'marketing-config'],
    queryFn: () => getMarketingConfig(),
    initialData: initial.config,
    staleTime: 60_000,
  })
  const { data: internalTenants = initial.internalTenants } = useQuery({
    queryKey: ['admin', 'marketing-internal-tenants'],
    queryFn: () => listInternalTenants(),
    initialData: initial.internalTenants,
    staleTime: 60_000,
  })
  const { data: agents = initial.agents } = useQuery({
    queryKey: ['admin', 'marketing-agents'],
    queryFn: () => listAgents(),
    initialData: initial.agents,
    staleTime: 30_000,
  })

  const globalCap = Number(config?.marketingCapPct ?? 10)

  async function refreshAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'marketing-config'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'marketing-internal-tenants'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'marketing-agents'] }),
    ])
    await router.invalidate()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Tim Marketing</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Atur cap global, tentukan organisasi internal, daftarkan kepala marketing,
          dan pantau seluruh agen.
        </p>
      </div>

      <ConfigCard globalCap={globalCap} onSaved={refreshAll} />
      <InternalTenantCard internalTenants={internalTenants} onChanged={refreshAll} />
      <EnrollHeadCard internalTenants={internalTenants} globalCap={globalCap} onEnrolled={refreshAll} />
      <RosterCard agents={agents} globalCap={globalCap} onChanged={refreshAll} />
    </div>
  )
}

// ── Config ──────────────────────────────────────────────────────────

function ConfigCard({ globalCap, onSaved }: { globalCap: number; onSaved: () => void }) {
  const { toast } = useToast()
  const [value, setValue] = useState(globalCap.toFixed(2))
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      toast({ title: 'Persentase tidak valid', variant: 'error' })
      return
    }
    setSaving(true)
    try {
      await updateMarketingConfig({ data: { marketingCapPct: value } })
      toast({ title: 'Cap global disimpan', variant: 'success' })
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
        <CardTitle>Cap Global Marketing</CardTitle>
        <CardDescription>
          Batas maksimum total (diskon + komisi staf + override kepala) per
          transaksi. Cap setiap kepala tidak boleh melebihi nilai ini.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="flex max-w-xs items-end gap-3">
          <Input
            label="Cap global (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" variant="brand" loading={saving}>
            Simpan
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Internal tenant designation ─────────────────────────────────────

type InternalTenant = Awaited<ReturnType<typeof listInternalTenants>>[number]

function InternalTenantCard({
  internalTenants,
  onChanged,
}: {
  internalTenants: InternalTenant[]
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<
    Awaited<ReturnType<typeof searchTenantsForInternal>>
  >([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      setResults(await searchTenantsForInternal({ data: { query: query.trim() } }))
    } catch (err) {
      toast({ title: 'Gagal mencari', description: (err as Error).message, variant: 'error' })
    } finally {
      setSearching(false)
    }
  }

  async function handleToggle(tenantId: string, isInternal: boolean) {
    setBusyId(tenantId)
    try {
      await setTenantInternal({ data: { tenantId, isInternal } })
      toast({
        title: isInternal ? 'Tenant ditandai internal' : 'Tenant dilepas dari internal',
        variant: 'success',
      })
      setResults((rows) => rows.map((r) => (r.id === tenantId ? { ...r, isInternal } : r)))
      onChanged()
    } catch (err) {
      toast({ title: 'Gagal mengubah', description: (err as Error).message, variant: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisasi Internal</CardTitle>
        <CardDescription>
          Tenant yang ditandai internal — anggotanya bisa didaftarkan sebagai agen
          marketing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {internalTenants.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {internalTenants.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-2 rounded-full bg-brand-100 px-3 py-1 text-sm font-medium text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
              >
                {t.businessName}
                <button
                  type="button"
                  className="text-xs text-brand-500 hover:text-danger-600"
                  disabled={busyId === t.id}
                  onClick={() => handleToggle(t.id, false)}
                  aria-label={`Lepas ${t.businessName}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Belum ada tenant internal. Cari dan tandai satu di bawah.
          </p>
        )}

        <form onSubmit={handleSearch} className="flex max-w-md items-end gap-2">
          <div className="flex-1">
            <Input
              label="Cari tenant"
              placeholder="Nama bisnis…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Button type="submit" variant="outline" loading={searching}>
            <Search className="h-4 w-4" />
            Cari
          </Button>
        </form>

        {results.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bisnis</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.businessName}</TableCell>
                    <TableCell>
                      {r.isInternal ? (
                        <span className="text-xs font-medium text-success-600">Internal</span>
                      ) : (
                        <span className="text-xs text-gray-400">Biasa</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={r.isInternal ? 'ghost' : 'brand'}
                        loading={busyId === r.id}
                        onClick={() => handleToggle(r.id, !r.isInternal)}
                      >
                        {r.isInternal ? 'Lepas' : 'Tandai Internal'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Enroll head ─────────────────────────────────────────────────────

function EnrollHeadCard({
  internalTenants,
  globalCap,
  onEnrolled,
}: {
  internalTenants: InternalTenant[]
  globalCap: number
  onEnrolled: () => void
}) {
  const { toast } = useToast()
  const [tenantId, setTenantId] = useState('')
  const [userId, setUserId] = useState('')
  const [capPct, setCapPct] = useState(globalCap.toFixed(2))
  const [saving, setSaving] = useState(false)

  const { data: candidates = [] } = useQuery({
    queryKey: ['admin', 'marketing-head-candidates', tenantId],
    queryFn: () => listEnrollableHeadCandidates({ data: { tenantId } }),
    enabled: !!tenantId,
    staleTime: 30_000,
  })

  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantId || !userId) {
      toast({ title: 'Pilih tenant dan anggota dulu', variant: 'error' })
      return
    }
    setSaving(true)
    try {
      await enrollHead({ data: { tenantId, userId, capPct } })
      toast({ title: 'Kepala marketing didaftarkan', variant: 'success' })
      setUserId('')
      onEnrolled()
    } catch (err) {
      toast({ title: 'Gagal mendaftarkan', description: (err as Error).message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daftarkan Kepala Marketing</CardTitle>
        <CardDescription>
          Pilih anggota tenant internal untuk dijadikan kepala. Cap kepala maksimum{' '}
          {globalCap.toFixed(2)}%.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {internalTenants.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Tandai tenant internal dulu di atas.
          </p>
        ) : (
          <form onSubmit={handleEnroll} className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Select
              label="Tenant internal"
              placeholder="Pilih tenant…"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value)
                setUserId('')
              }}
              options={internalTenants.map((t) => ({ value: t.id, label: t.businessName }))}
            />
            <Select
              label="Anggota"
              placeholder={tenantId ? 'Pilih anggota…' : 'Pilih tenant dulu'}
              value={userId}
              disabled={!tenantId}
              onChange={(e) => setUserId(e.target.value)}
              options={candidates.map((c) => ({
                value: c.userId,
                label:
                  [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
                  c.jobTitle ||
                  c.userId.slice(0, 8),
              }))}
            />
            <Input
              label="Cap kepala (%)"
              type="number"
              step="0.01"
              min="0"
              max={globalCap}
              value={capPct}
              onChange={(e) => setCapPct(e.target.value)}
            />
            <div className="flex items-end">
              <Button type="submit" variant="brand" loading={saving} disabled={!userId}>
                Daftarkan Kepala
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

// ── Roster ──────────────────────────────────────────────────────────

function RosterCard({
  agents,
  globalCap,
  onChanged,
}: {
  agents: Agent[]
  globalCap: number
  onChanged: () => void
}) {
  const { toast } = useToast()
  const [editingHead, setEditingHead] = useState<Agent | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleToggleActive(agent: Agent) {
    setBusyId(agent.id)
    try {
      await setAgentActive({ data: { agentId: agent.id, isActive: !agent.isActive } })
      toast({ title: agent.isActive ? 'Agen dinonaktifkan' : 'Agen diaktifkan', variant: 'success' })
      onChanged()
    } catch (err) {
      toast({ title: 'Gagal mengubah', description: (err as Error).message, variant: 'error' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Semua Agen</CardTitle>
        <CardDescription>Kepala dan staf di seluruh program marketing.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 py-0">
        {agents.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            Belum ada agen. Daftarkan kepala marketing di atas.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Peran</TableHead>
                <TableHead>Kepala</TableHead>
                <TableHead className="text-right">Cap / Budget</TableHead>
                <TableHead className="text-right">Referral</TableHead>
                <TableHead className="text-right">Komisi</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>
                    <span
                      className={
                        'rounded-full px-2 py-0.5 text-xs font-medium ' +
                        (a.role === 'head'
                          ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')
                      }
                    >
                      {a.role === 'head' ? 'Kepala' : 'Staf'}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {a.parentName ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {a.role === 'head'
                      ? `${parseFloat(a.capPct ?? '0').toFixed(2)}%`
                      : `${parseFloat(a.staffBudgetPct ?? '0').toFixed(2)}% (+${parseFloat(a.headOverridePct ?? '0').toFixed(2)}%)`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{a.referralCount}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatRupiah(parseFloat(a.totalCommission))}
                  </TableCell>
                  <TableCell>
                    <span
                      className={
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ' +
                        (a.isActive
                          ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')
                      }
                    >
                      {a.isActive ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {a.role === 'head' && (
                        <Button size="sm" variant="ghost" onClick={() => setEditingHead(a)}>
                          Cap
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busyId === a.id}
                        onClick={() => handleToggleActive(a)}
                      >
                        {a.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <EditHeadCapSheet
        head={editingHead}
        globalCap={globalCap}
        onClose={() => setEditingHead(null)}
        onSaved={() => {
          setEditingHead(null)
          onChanged()
        }}
      />
    </Card>
  )
}

function EditHeadCapSheet({
  head,
  globalCap,
  onClose,
  onSaved,
}: {
  head: Agent | null
  globalCap: number
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Sheet open={!!head} onClose={onClose}>
      <SheetHeader onClose={onClose}>
        <SheetTitle>Ubah Cap Kepala</SheetTitle>
        <SheetDescription>
          {head?.name} — cap maksimum {globalCap.toFixed(2)}% (cap global).
        </SheetDescription>
      </SheetHeader>
      {head && (
        // key remounts the form per head so the input seeds cleanly.
        <EditHeadCapForm
          key={head.id}
          head={head}
          globalCap={globalCap}
          onClose={onClose}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  )
}

function EditHeadCapForm({
  head,
  globalCap,
  onClose,
  onSaved,
}: {
  head: Agent
  globalCap: number
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [capPct, setCapPct] = useState(parseFloat(head.capPct ?? '0').toFixed(2))
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await updateHeadCap({ data: { agentId: head.id, capPct } })
      toast({ title: 'Cap kepala disimpan', variant: 'success' })
      onSaved()
    } catch (err) {
      toast({ title: 'Gagal menyimpan', description: (err as Error).message, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSave}>
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        <Input
          label="Cap kepala (%)"
          type="number"
          step="0.01"
          min="0"
          max={globalCap}
          value={capPct}
          onChange={(e) => setCapPct(e.target.value)}
          autoFocus
        />
        <p className="text-xs text-gray-500">
          Mengubah cap hanya memengaruhi alokasi & komisi berikutnya — komisi yang
          sudah tercatat tidak berubah.
        </p>
      </div>
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
        <Button type="button" variant="ghost" onClick={onClose}>
          Batal
        </Button>
        <Button type="submit" variant="brand" loading={saving}>
          Simpan
        </Button>
      </div>
    </form>
  )
}
