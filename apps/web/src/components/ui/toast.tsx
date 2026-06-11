import * as React from 'react'
import { cn } from '@/lib/utils'

type ToastVariant = 'success' | 'error' | 'info'

interface Toast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
}

interface ToastOptions {
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-l-4 border-l-success-500 bg-white dark:bg-gray-800',
  error: 'border-l-4 border-l-danger-500 bg-white dark:bg-gray-800',
  info: 'border-l-4 border-l-primary-500 bg-white dark:bg-gray-800',
}

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  success: (
    <svg
      className="h-5 w-5 text-success-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  ),
  error: (
    <svg
      className="h-5 w-5 text-danger-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
      />
    </svg>
  ),
  info: (
    <svg
      className="h-5 w-5 text-primary-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
      />
    </svg>
  ),
}

let toastCounter = 0

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const toast = React.useCallback((options: ToastOptions) => {
    const id = `toast-${++toastCounter}`
    const newToast: Toast = {
      id,
      title: options.title,
      description: options.description,
      variant: options.variant || 'info',
    }

    setToasts((prev) => [...prev, newToast])

    // Auto dismiss after 3 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const contextValue = React.useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={contextValue}>
      {children}

      {/* Toast container - bottom right */}
      {toasts.length > 0 && (
        <div
          className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2"
          aria-live="polite"
          aria-label="Notifikasi"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cn(
                'flex w-80 items-start gap-3 rounded-lg border border-gray-200 p-4 shadow-lg dark:border-gray-700 dark:shadow-gray-900/50',
                'animate-in slide-in-from-right-full fade-in-0',
                variantStyles[t.variant],
              )}
              role="alert"
            >
              <div className="shrink-0 pt-0.5">
                {variantIcons[t.variant]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t.title}</p>
                {t.description && (
                  <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md p-1 text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-gray-500 dark:hover:text-gray-400"
                onClick={() => removeToast(t.id)}
                aria-label="Tutup"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18 18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}

function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext)
  if (!context) {
    throw new Error('useToast harus digunakan di dalam ToastProvider')
  }
  return context
}

export { ToastProvider, useToast, type ToastOptions, type ToastVariant }
