import * as React from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

interface SheetProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
}

function Sheet({ open, onClose, children, className }: SheetProps) {
  // Close on Escape key
  React.useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-50 flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-gray-800 dark:shadow-gray-900/50',
          'animate-sheet-in',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

function SheetHeader({
  className,
  onClose,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }) {
  return (
    <div
      className={cn('flex items-start justify-between border-b border-gray-200 px-6 py-5 dark:border-gray-700', className)}
      {...props}
    >
      <div className="flex flex-col gap-1">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
          aria-label="Tutup"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

function SheetTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('text-lg font-semibold text-gray-900 dark:text-gray-100', className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('text-sm text-gray-500 dark:text-gray-400', className)}
      {...props}
    />
  )
}

function SheetContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex-1 overflow-y-auto px-6 py-5', className)}
      {...props}
    />
  )
}

function SheetFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700',
        className,
      )}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetContent,
  SheetFooter,
}
