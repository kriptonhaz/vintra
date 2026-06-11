import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Props {
  open: boolean
  src: string | null
  alt?: string
  caption?: string
  onClose: () => void
}

/**
 * Fullscreen image preview with backdrop click + Escape to close.
 * Image is constrained to `max-h-[90vh]` / `max-w-[90vw]` so large photos
 * don't overflow the viewport; smaller images render at natural size.
 */
export function ImagePreviewModal({
  open,
  src,
  alt,
  caption,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open || !src) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="fixed inset-0 bg-black/80"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="relative z-[61] flex max-h-[90vh] max-w-[90vw] flex-col items-center gap-3">
        <img
          src={src}
          alt={alt ?? 'preview'}
          className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-2xl"
        />
        {caption && (
          <p className="rounded bg-black/60 px-3 py-1 text-sm text-white backdrop-blur">
            {caption}
          </p>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup"
          className="absolute -top-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-gray-700 shadow-lg transition-colors hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
