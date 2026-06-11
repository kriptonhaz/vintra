import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Gift } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  getTenantReferralAccess,
  setTenantReferralAccess,
} from '@/server/functions/admin-referral-access'

/**
 * Admin card on /admin/tenants/:id — toggles a tenant's referral
 * program access and sets its per-tenant discount/commission cap.
 *
 * Turning access OFF freezes every one of the tenant's referral
 * codes (handled server-side); existing attributions + commissions
 * are grandfathered. The card warns the admin before that happens.
 */
export function TenantReferralAccessCard({ tenantId }: { tenantId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['admin-tenant-referral-access', tenantId],
    queryFn: () => getTenantReferralAccess({ data: { tenantId } }),
    staleTime: 30_000,
  })

  const [enabled, setEnabled] = React.useState(false)
  const [capStr, setCapStr] = React.useState('')
  // Track whether the local form state has been seeded from the query
  // so we don't clobber admin edits on a background refetch.
  const seeded = React.useRef(false)

  React.useEffect(() => {
    if (!data || seeded.current) return
    seeded.current = true
    setEnabled(data.settings?.enabled ?? false)
    setCapStr(
      data.settings?.capPct ?? String(data.globalCapPct),
    )
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      setTenantReferralAccess({
        data: { tenantId, enabled, capPct: capStr },
      }),
    onSuccess: (res) => {
      toast({
        title: 'Akses referral disimpan',
        description: res.codesFrozen
          ? 'Kode referral tenant ini dibekukan.'
          : undefined,
        variant: 'success',
      })
      queryClient.invalidateQueries({
        queryKey: ['admin-tenant-referral-access', tenantId],
      })
    },
    onError: (err) => {
      toast({
        title: 'Gagal menyimpan akses referral',
        description: err instanceof Error ? err.message : 'Coba lagi',
        variant: 'error',
      })
    },
  })

  if (!data) return null

  const wasEnabled = data.settings?.enabled === true
  const willFreeze =
    wasEnabled && !enabled && data.activeCodeCount > 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Akses Referral
          </h2>
        </div>
        <Link
          to="/admin/referrals/access"
          className="text-xs text-brand-600 hover:underline dark:text-brand-400"
        >
          Lihat audit lengkap
        </Link>
      </div>

      <div className="space-y-4">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Aktifkan program referral
            </p>
            <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
              Tenant ini bisa membuat kode referral, melihat pendaftar,
              dan klaim komisi. Tenant di luar daftar ini tidak melihat
              menu Referral sama sekali.
            </p>
          </div>
        </label>

        <div className="max-w-xs">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Cap discount + komisi
          </label>
          <div className="relative">
            <Input
              type="number"
              min={1}
              max={100}
              step={1}
              value={capStr}
              onChange={(e) => setCapStr(e.target.value)}
              disabled={!enabled}
              className="pr-8 tabular-nums"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
              %
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Total discount + komisi pada tiap kode tenant ini tidak
            boleh melebihi nilai ini. Default global: {data.globalCapPct}%.
          </p>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400">
          {data.totalCodeCount > 0 ? (
            <>
              Tenant punya {data.totalCodeCount} kode ({data.activeCodeCount}{' '}
              aktif).
            </>
          ) : (
            'Tenant belum membuat kode referral.'
          )}
        </div>

        {willFreeze && (
          <div className="rounded-lg border border-warning-300 bg-warning-50 p-3 dark:border-warning-900/50 dark:bg-warning-900/20">
            <p className="text-xs text-warning-900 dark:text-warning-200">
              Menonaktifkan akan membekukan {data.activeCodeCount} kode
              aktif (tidak bisa dipakai pendaftar baru). Pendaftar &
              komisi yang sudah ada tetap berjalan.
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <Button
            variant="brand"
            onClick={() => save.mutate()}
            loading={save.isPending}
          >
            Simpan
          </Button>
        </div>
      </div>
    </div>
  )
}
