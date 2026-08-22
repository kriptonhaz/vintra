import { AlertTriangle } from 'lucide-react'
import type { ErrorComponentProps } from '@tanstack/react-router'

/**
 * What a page shows when its component throws.
 *
 * Without an `errorComponent` configured, TanStack installs no catch
 * boundary at all — `Match.js` resolves the boundary to a plain fragment
 * unless one is provided. A render error then unmounts the entire app,
 * and the only thing reaching the console is React's own teardown
 * failure ("Failed to execute 'removeChild'"), which describes the
 * collapse rather than its cause. The real error is lost, and the user
 * gets a white screen with no way forward.
 *
 * So this exists as much to make errors REPORTABLE as to look tidy: the
 * message is on screen where a merchant can photograph it, the rest of
 * the app stays mounted so they can navigate away, and the stack is one
 * click away for whoever gets the screenshot.
 *
 * Deliberately plain: no translation hook, no data fetching, no router
 * `Link`. This renders precisely when something else has already gone
 * wrong, and an error screen that can itself throw is worse than none.
 */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Terjadi kesalahan yang tidak diketahui.'

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Halaman ini gagal dimuat
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Data Anda aman — yang gagal hanya tampilan halaman ini. Coba
              muat ulang, atau kembali ke Dashboard.
            </p>

            <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 font-mono text-xs break-words text-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
              {message}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                Coba lagi
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Muat ulang halaman
              </button>
              <a
                href="/dashboard"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Kembali ke Dashboard
              </a>
            </div>

            {error instanceof Error && error.stack && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                  Detail teknis
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-gray-900 p-3 text-[11px] leading-relaxed text-gray-100">
                  {error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
