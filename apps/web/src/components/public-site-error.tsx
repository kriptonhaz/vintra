import { Zap } from 'lucide-react'

/**
 * JUR-189 (#199): branded fallback for a claimed tenant subdomain
 * whose data fetch failed. Never a raw 500 — the visitor gets a calm
 * "try again" message instead of a stack trace. Rendered by both the
 * Host-aware index route and the `/q/$slug` direct route.
 *
 * Kept stateless and dependency-free so a tenant-data outage can't
 * cascade into a render error inside the error page itself.
 */
export function PublicSiteError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-100">
          <Zap className="h-7 w-7 text-brand-600" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">
          Situs sedang gangguan
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          Halaman ini gagal dimuat. Coba muat ulang beberapa saat lagi.
        </p>
      </div>
    </div>
  )
}
