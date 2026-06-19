import * as React from 'react'
import { ImagePlus, Stamp, X as XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Normalized stamp-card layout. Mirrors StampCardLayout in @vintra/db.
 * Coordinates/sizes are 0..1 fractions of the base design so rendering
 * is resolution-independent.
 */
export type StampCardLayout = {
  cols: number
  rows: number
  cells: { x: number; y: number }[]
  markScale: number
  markOpacity: number
  grid?: { x: number; y: number; w: number; h: number }
}

type Props = {
  /** Stamps required to fill the card — drives row count + preview fill. */
  stampsRequired: number
  /** Preview src for the base design (fresh data URL or signed URL). */
  designSrc: string | null
  /** Preview src for the stamp mark. */
  markSrc: string | null
  /** Persisted layout to rehydrate from (edit mode). */
  initialLayout: StampCardLayout | null
  /** 'none' | 'pending' | 'ready' | 'failed' */
  renderStatus?: string | null
  onPickDesign: (file: File) => void
  onPickMark: (file: File) => void
  /** Remove the whole card (design + mark + rendered states). */
  onRemove: () => void
  onLayoutChange: (layout: StampCardLayout) => void
}

const DEFAULT_GRID = { x: 0.1, y: 0.45, w: 0.8, h: 0.4 }

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * Grid-overlay card editor. The merchant uploads a base design + a stamp
 * mark, then drags/sizes a cols×rows grid to line up with the empty
 * slots on their design. We emit normalized cell centers; the Go API
 * pre-renders every fill state from them. Row count is derived from
 * stampsRequired so the grid always has enough cells.
 */
export function StampCardEditor({
  stampsRequired,
  designSrc,
  markSrc,
  initialLayout,
  renderStatus,
  onPickDesign,
  onPickMark,
  onRemove,
  onLayoutChange,
}: Props) {
  const [cols, setCols] = React.useState(
    () => initialLayout?.cols ?? Math.min(5, Math.max(1, stampsRequired)),
  )
  const [grid, setGrid] = React.useState(
    () => initialLayout?.grid ?? DEFAULT_GRID,
  )
  const [markScale, setMarkScale] = React.useState(
    () => initialLayout?.markScale ?? 0.12,
  )
  const [markOpacity, setMarkOpacity] = React.useState(
    () => initialLayout?.markOpacity ?? 1,
  )

  const rows = Math.max(1, Math.ceil(stampsRequired / Math.max(1, cols)))

  // Row-major cell centers within the grid rect.
  const cells = React.useMemo(() => {
    const out: { x: number; y: number }[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({
          x: grid.x + ((c + 0.5) / cols) * grid.w,
          y: grid.y + ((r + 0.5) / rows) * grid.h,
        })
      }
    }
    return out
  }, [cols, rows, grid])

  // Emit the layout upward whenever any knob changes — but only once we
  // have a design (a card without artwork shouldn't persist a layout).
  // In edit mode (initialLayout present) skip the first emit so merely
  // re-opening a program doesn't mark the card dirty and re-render it;
  // in create mode emit as soon as a design is picked.
  const onChangeRef = React.useRef(onLayoutChange)
  onChangeRef.current = onLayoutChange
  const emittedRef = React.useRef(!initialLayout)
  React.useEffect(() => {
    if (!designSrc) return
    if (!emittedRef.current) {
      emittedRef.current = true
      return
    }
    onChangeRef.current({ cols, rows, cells, markScale, markOpacity, grid })
  }, [designSrc, cols, rows, cells, markScale, markOpacity, grid])

  // ── Pointer drag/resize on the grid rect ──────────────────────────
  const containerRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{
    mode: 'move' | 'resize'
    startX: number
    startY: number
    orig: typeof grid
  } | null>(null)

  function onPointerDown(mode: 'move' | 'resize', e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: grid,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }
  function onPointerMove(e: PointerEvent) {
    const drag = dragRef.current
    const box = containerRef.current?.getBoundingClientRect()
    if (!drag || !box || box.width === 0 || box.height === 0) return
    const dx = (e.clientX - drag.startX) / box.width
    const dy = (e.clientY - drag.startY) / box.height
    if (drag.mode === 'move') {
      setGrid({
        ...drag.orig,
        x: clamp(drag.orig.x + dx, 0, 1 - drag.orig.w),
        y: clamp(drag.orig.y + dy, 0, 1 - drag.orig.h),
      })
    } else {
      setGrid({
        ...drag.orig,
        w: clamp(drag.orig.w + dx, 0.05, 1 - drag.orig.x),
        h: clamp(drag.orig.h + dy, 0.05, 1 - drag.orig.y),
      })
    }
  }
  function onPointerUp() {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }
  React.useEffect(
    () => () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    },
    [],
  )

  function pickFile(e: React.ChangeEvent<HTMLInputElement>, cb: (f: File) => void) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !file.type.startsWith('image/')) return
    cb(file)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Kartu stempel digital (opsional)
        </label>
        {designSrc && (
          <button
            type="button"
            onClick={onRemove}
            className="text-xs text-gray-500 hover:text-danger-600"
          >
            Hapus kartu
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Unggah desain kartu, lalu geser & ubah ukuran kotak grid agar pas
        di slot stempel. Sistem otomatis membuat gambar untuk tiap jumlah
        stempel (0 sampai {stampsRequired}).
      </p>

      {!designSrc ? (
        <label className="flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-400">
          <ImagePlus className="h-6 w-6" />
          <span>Unggah desain kartu (maks. 4 MB)</span>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => pickFile(e, onPickDesign)}
            className="hidden"
          />
        </label>
      ) : (
        <>
          {/* Design canvas + grid overlay + live preview */}
          <div
            ref={containerRef}
            className="relative w-full select-none overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
          >
            <img
              src={designSrc}
              alt="Desain kartu"
              className="block w-full"
              draggable={false}
            />
            {/* Grid rect — draggable body + resize handle */}
            <div
              onPointerDown={(e) => onPointerDown('move', e)}
              className="absolute cursor-move rounded-sm border-2 border-brand-500/80 bg-brand-500/5"
              style={{
                left: `${grid.x * 100}%`,
                top: `${grid.y * 100}%`,
                width: `${grid.w * 100}%`,
                height: `${grid.h * 100}%`,
              }}
            >
              {/* cell guides */}
              <div
                className="grid h-full w-full"
                style={{
                  gridTemplateColumns: `repeat(${cols}, 1fr)`,
                  gridTemplateRows: `repeat(${rows}, 1fr)`,
                }}
              >
                {Array.from({ length: cols * rows }).map((_, i) => (
                  <div
                    key={i}
                    className="border border-dashed border-brand-400/50"
                  />
                ))}
              </div>
              <div
                onPointerDown={(e) => onPointerDown('resize', e)}
                className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-se-resize rounded-full border-2 border-white bg-brand-500 shadow"
              />
            </div>
            {/* Live stamp preview — first N cells filled */}
            {markSrc &&
              cells.slice(0, stampsRequired).map((cell, i) => (
                <img
                  key={i}
                  src={markSrc}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${cell.x * 100}%`,
                    top: `${cell.y * 100}%`,
                    width: `${markScale * 100}%`,
                    opacity: markOpacity,
                  }}
                />
              ))}
          </div>

          {/* Controls */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                Kolom grid
              </label>
              <input
                type="number"
                min={1}
                max={stampsRequired}
                value={cols}
                onChange={(e) =>
                  setCols(
                    clamp(
                      Number(e.target.value) || 1,
                      1,
                      Math.max(1, stampsRequired),
                    ),
                  )
                }
                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
              <p className="mt-1 text-xs text-gray-400">
                {cols} kolom × {rows} baris
              </p>
            </div>
            <div className="flex items-center justify-center rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
              {markSrc ? (
                <div className="relative p-2">
                  <img
                    src={markSrc}
                    alt="Stempel"
                    className="h-12 w-12 object-contain"
                  />
                  <label className="mt-1 block cursor-pointer text-center text-xs text-brand-600 hover:underline">
                    Ganti stempel
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => pickFile(e, onPickMark)}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center gap-1 p-3 text-xs text-gray-500 hover:text-brand-600">
                  <Stamp className="h-5 w-5" />
                  <span>Unggah gambar stempel</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => pickFile(e, onPickMark)}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                Ukuran stempel
              </label>
              <input
                type="range"
                min={5}
                max={40}
                value={Math.round(markScale * 100)}
                onChange={(e) => setMarkScale(Number(e.target.value) / 100)}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                Transparansi stempel
              </label>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(markOpacity * 100)}
                onChange={(e) => setMarkOpacity(Number(e.target.value) / 100)}
                className="w-full"
              />
            </div>
          </div>

          {!markSrc && (
            <p className="text-xs text-amber-600">
              Unggah gambar stempel agar kartu bisa dibuat.
            </p>
          )}
          {renderStatus && (
            <p
              className={cn(
                'text-xs',
                renderStatus === 'ready' && 'text-emerald-600',
                renderStatus === 'pending' && 'text-gray-500',
                renderStatus === 'failed' && 'text-danger-600',
              )}
            >
              {renderStatus === 'ready' && 'Kartu siap dikirim.'}
              {renderStatus === 'pending' && 'Sedang membuat gambar kartu…'}
              {renderStatus === 'failed' &&
                'Gagal membuat kartu — simpan ulang untuk mencoba lagi.'}
            </p>
          )}
        </>
      )}
    </div>
  )
}
