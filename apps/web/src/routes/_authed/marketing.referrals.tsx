import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { listMyReferrals } from '@/server/functions/marketing-commission'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { formatRupiah } from '@/lib/currency'
import { formatDate } from '@/lib/utils'

export const Route = createFileRoute('/_authed/marketing/referrals')({
  loader: async () => ({ referrals: await listMyReferrals() }),
  component: MarketingReferralsPage,
})

function MarketingReferralsPage() {
  const initial = Route.useLoaderData()
  const { data: referrals = initial.referrals } = useQuery({
    queryKey: ['marketing', 'referrals'],
    queryFn: () => listMyReferrals(),
    initialData: initial.referrals,
    staleTime: 30_000,
  })

  if (referrals.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
          Belum ada pendaftar dari kode Anda. Bagikan kode di tab Kode untuk mulai
          mengajak pelanggan.
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
              <TableHead>Pelanggan</TableHead>
              <TableHead>Tanggal Daftar</TableHead>
              <TableHead>Modul Aktif</TableHead>
              <TableHead className="text-right">Total Bayar</TableHead>
              <TableHead className="text-right">Komisi Saya</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {referrals.map((r) => (
              <TableRow key={r.attributionId}>
                <TableCell className="font-medium">{r.refereeName}</TableCell>
                <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                  {formatDate(r.attributedAt, 'dd MMM yyyy')}
                </TableCell>
                <TableCell>
                  {r.activeModules.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {r.activeModules.map((m) => (
                        <span
                          key={m}
                          className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium uppercase text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                        >
                          {m}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">Belum berlangganan</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatRupiah(parseFloat(r.totalPaid))}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-success-700 dark:text-success-400">
                  {formatRupiah(parseFloat(r.myCommission))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
