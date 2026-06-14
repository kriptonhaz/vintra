/**
 * Toko Online — admin review moderation.
 *
 * Komplit-gated (same as the rest of Situs). Lists customer product
 * reviews newest-first; reviews auto-publish, so this screen exists to
 * hide abusive/spam ones (and unhide if needed). Hidden reviews stay in
 * the list, dimmed, with an "unhide" affordance.
 */
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Star, EyeOff, Eye } from 'lucide-react'
import {
  listStorefrontReviews,
  setStorefrontReviewHidden,
} from '@/server/functions/online-orders'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/site/reviews')({
  beforeLoad: ({ context }) => {
    const user = (
      context as {
        user?: {
          permissions?: string[]
          moduleSubscriptions?: { pos?: { features?: ReadonlyArray<string> } }
        }
      }
    ).user
    if (!user?.permissions?.includes('booking.write')) {
      throw redirect({ to: '/dashboard' })
    }
    if (!user.moduleSubscriptions?.pos?.features?.includes('tenant_site')) {
      throw redirect({ to: '/site/locked' })
    }
  },
  component: ReviewsPage,
})

function ReviewsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['tenant', 'storefront-reviews'],
    queryFn: () => listStorefrontReviews({ data: { includeHidden: true } }),
  })

  const hideMut = useMutation({
    mutationFn: (vars: { id: string; hidden: boolean }) =>
      setStorefrontReviewHidden({ data: vars }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['tenant', 'storefront-reviews'] })
      toast({
        title: vars.hidden ? 'Ulasan disembunyikan' : 'Ulasan ditampilkan',
        variant: 'success',
      })
    },
    onError: () =>
      toast({ title: 'Gagal memperbarui ulasan', variant: 'error' }),
  })

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8">
      <ModuleBreadcrumb />
      <div className="mt-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Ulasan Produk
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Ulasan dari pembeli yang pesanannya sudah selesai. Sembunyikan
          ulasan yang tidak pantas.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-500 dark:border-gray-700">
          Belum ada ulasan.
        </div>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <li
              key={r.id}
              className={cn(
                'rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900',
                r.isHidden && 'opacity-60',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {r.productName ?? 'Produk dihapus'}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={cn(
                            'h-4 w-4',
                            n <= r.rating
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-gray-300 dark:text-gray-600',
                          )}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {r.customerName}
                    </span>
                    {r.isHidden && (
                      <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        Disembunyikan
                      </span>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-gray-400">
                  {new Date(r.createdAt).toLocaleDateString('id-ID', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              </div>

              {r.comment && (
                <p className="mt-2 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">
                  {r.comment}
                </p>
              )}

              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    hideMut.mutate({ id: r.id, hidden: !r.isHidden })
                  }
                  disabled={hideMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {r.isHidden ? (
                    <>
                      <Eye className="h-3.5 w-3.5" /> Tampilkan
                    </>
                  ) : (
                    <>
                      <EyeOff className="h-3.5 w-3.5" /> Sembunyikan
                    </>
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
