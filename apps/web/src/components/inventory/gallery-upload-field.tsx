import * as React from 'react'
import { Loader2, Plus, X } from 'lucide-react'
import { compressImage } from '@/lib/image-compress'
import {
  getInventoryItemPhotos,
  addInventoryItemPhoto,
  removeInventoryItemGalleryPhoto,
  MAX_INVENTORY_GALLERY_PHOTOS,
} from '@/server/functions/inventory'
import { cn } from '@/lib/utils'

interface GalleryPhoto {
  id: string
  url: string | null
}

interface GalleryUploadFieldProps {
  itemId: string
  disabled?: boolean
  className?: string
}

/**
 * Extra storefront photos for an item (a gallery), shown on the public
 * product detail page in addition to the cover photo. Unlike the cover
 * uploader (which defers the S3 call to form submit), gallery edits fire
 * immediately — the item already exists on this edit screen, so there's
 * nothing to defer and immediate feedback is simpler.
 *
 * Compresses to ~800px JPEG client-side, same 500 KB ceiling as the
 * cover. Capped at MAX_INVENTORY_GALLERY_PHOTOS.
 */
export function GalleryUploadField({
  itemId,
  disabled,
  className,
}: GalleryUploadFieldProps) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = React.useState<GalleryPhoto[]>([])
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    getInventoryItemPhotos({ data: { itemId } })
      .then((rows) => {
        if (!cancelled) setPhotos(rows.map((r) => ({ id: r.id, url: r.url })))
      })
      .catch(() => {
        // Non-fatal — start empty, the user can still add.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [itemId])

  const full = photos.length >= MAX_INVENTORY_GALLERY_PHOTOS

  async function handleFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const { dataUrl, bytes } = await compressImage(file, {
        maxEdge: 800,
        quality: 0.8,
      })
      if (bytes > 500 * 1024) {
        setError(
          `Foto masih ${Math.round(bytes / 1024)} KB setelah kompres. Coba foto lain.`,
        )
        return
      }
      const row = await addInventoryItemPhoto({
        data: { itemId, photoDataUrl: dataUrl },
      })
      setPhotos((prev) => [...prev, { id: row.id, url: row.url }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah foto.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRemove(id: string) {
    setError(null)
    const prev = photos
    setPhotos((p) => p.filter((x) => x.id !== id))
    try {
      await removeInventoryItemGalleryPhoto({ data: { photoId: id } })
    } catch (err) {
      // Restore on failure.
      setPhotos(prev)
      setError(err instanceof Error ? err.message : 'Gagal menghapus foto.')
    }
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled || busy || full}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
        className="hidden"
      />

      {loading ? (
        <div className="flex h-20 items-center justify-center text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div
              key={p.id}
              className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
            >
              {p.url ? (
                <img src={p.url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full" />
              )}
              <button
                type="button"
                onClick={() => handleRemove(p.id)}
                disabled={disabled || busy}
                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-700 shadow-sm hover:text-danger-600 disabled:opacity-50 dark:bg-gray-900/90 dark:text-gray-300"
                aria-label="Hapus foto"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}

          {!full && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || busy}
              className={cn(
                'flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400',
              )}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Plus className="h-5 w-5" />
                  <span>Tambah</span>
                </>
              )}
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Foto tambahan untuk halaman produk toko online (maks.{' '}
        {MAX_INVENTORY_GALLERY_PHOTOS}). Foto utama diatur di atas.
      </p>
      {error && (
        <p className="text-xs text-danger-600 dark:text-danger-400">{error}</p>
      )}
    </div>
  )
}
