import * as React from 'react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  className?: string
  placement?: 'responsive' | 'center'
}

function Dialog({
  open,
  onClose,
  children,
  className,
  placement = 'responsive',
}: DialogProps) {
  // Close on Escape key
  React.useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    // Prevent body scroll when dialog is open
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  const centered = placement === 'center'

  // Layout switch:
  //  - Mobile (<md): bottom-anchored, full-width with rounded top, slides
  //    up from the bottom edge — thumb-friendly bottom-sheet pattern that
  //    matches Tokopedia/Shopee/Qasir behaviour on Android.
  //  - Desktop (md+): centered, max-width card with the existing scale-in.
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center',
        centered ? 'items-center p-4' : 'items-end md:items-center',
      )}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog panel */}
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative z-50 flex w-full flex-col bg-white shadow-xl dark:bg-gray-800 dark:shadow-gray-900/50',
          centered
            ? 'max-h-[85vh] max-w-lg overflow-hidden rounded-xl animate-dialog-in'
            : cn(
                // Mobile: full-width bottom sheet, taller cap, rounded top only.
                'max-h-[90vh] overflow-hidden rounded-t-2xl animate-bottom-sheet-in',
                // Desktop: centered card with horizontal margin + side rounding + scale-in.
                'md:mx-4 md:max-h-[85vh] md:max-w-lg md:rounded-xl md:animate-dialog-in',
              ),
          className,
        )}
      >
        {/* Drag handle — visual affordance only on mobile */}
        {!centered && (
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 md:hidden" />
        )}
        {children}
      </div>
    </div>
  )
}

function DialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-1.5 p-6 pb-0', className)}
      {...props}
    />
  )
}

function DialogTitle({
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

function DialogDescription({
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

function DialogContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex-1 overflow-y-auto p-6', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 px-6 pb-6 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
}
