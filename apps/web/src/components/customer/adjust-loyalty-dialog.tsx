import * as React from 'react'
import { useMutation } from '@tanstack/react-query'
import { Plus, Minus } from 'lucide-react'
import { adjustLoyaltyPoints } from '@/server/functions/pos'
import { adjustStampCard } from '@/server/functions/loyalty-stamps'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { formatNumberId } from '@/lib/currency'

type Mode = 'add' | 'subtract'

type PointsVariant = {
  kind: 'points'
  currentBalance: number
}
type StampsVariant = {
  kind: 'stamps'
  programId: string
  programName: string
  currentStamps: number
  stampsRequired: number
}

interface Props {
  open: boolean
  onClose: () => void
  customerId: string
  customerName: string
  variant: PointsVariant | StampsVariant
  onSaved?: () => void
}

/**
 * Manual adjust for a single customer's loyalty balance — points or
 * stamp card. Used for paper-card migrations and "saya lupa kasih
 * stempel kemarin" fixes. The dialog presents Tambah/Kurangi as
 * separate states (no signed input) and forces a reason so the
 * movement ledger keeps a real audit trail.
 *
 * Both shapes hit the existing `adjust*` server fns which already
 * enforce pos.manage permission + the Komplit feature gate.
 */
export function AdjustLoyaltyDialog({
  open,
  onClose,
  customerId,
  customerName,
  variant,
  onSaved,
}: Props) {
  const { toast } = useToast()
  const [mode, setMode] = React.useState<Mode>('add')
  const [amount, setAmount] = React.useState('')
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setMode('add')
      setAmount('')
      setReason('')
    }
  }, [open])

  const isPoints = variant.kind === 'points'
  const unitLabel = isPoints ? 'poin' : 'stempel'
  const currentValue = isPoints
    ? variant.currentBalance
    : variant.currentStamps

  const mut = useMutation({
    mutationFn: async (): Promise<void> => {
      const signed =
        mode === 'add' ? Number(amount) || 0 : -(Number(amount) || 0)
      if (variant.kind === 'points') {
        await adjustLoyaltyPoints({
          data: {
            customerId,
            points: signed,
            reason: reason.trim(),
          },
        })
        return
      }
      await adjustStampCard({
        data: {
          customerId,
          programId: variant.programId,
          stamps: signed,
          reason: reason.trim(),
        },
      })
    },
    onSuccess: () => {
      toast({
        title:
          mode === 'add'
            ? `${unitLabel === 'poin' ? 'Poin' : 'Stempel'} ditambahkan`
            : `${unitLabel === 'poin' ? 'Poin' : 'Stempel'} dikurangi`,
        variant: 'success',
      })
      onSaved?.()
      onClose()
    },
    onError: (err: Error) => {
      toast({
        title: 'Gagal menyimpan',
        description: err.message,
        variant: 'error',
      })
    },
  })

  const parsedAmount = Number(amount) || 0
  const canSave =
    parsedAmount > 0 &&
    reason.trim().length > 0 &&
    !mut.isPending &&
    // Block over-subtraction client-side so the user gets immediate
    // feedback; server enforces the same rule as a safety net.
    !(mode === 'subtract' && parsedAmount > currentValue)

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>
          Sesuaikan {isPoints ? 'Poin' : 'Stempel'}
        </DialogTitle>
        <DialogDescription>
          {customerName}
          {!isPoints && (
            <>
              {' '}
              · <span className="font-medium">{variant.programName}</span>
            </>
          )}
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800/40">
            <p className="text-xs text-gray-500">Saat ini</p>
            <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {formatNumberId(currentValue)} {unitLabel}
              {!isPoints && (
                <span className="text-sm font-normal text-gray-500">
                  {' '}
                  / {variant.stampsRequired}
                </span>
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
            <button
              type="button"
              onClick={() => setMode('add')}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors',
                mode === 'add'
                  ? 'bg-success-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700',
              )}
            >
              <Plus className="h-4 w-4" />
              Tambah
            </button>
            <button
              type="button"
              onClick={() => setMode('subtract')}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors',
                mode === 'subtract'
                  ? 'bg-warning-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700',
              )}
            >
              <Minus className="h-4 w-4" />
              Kurangi
            </button>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Jumlah {unitLabel}
            </label>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={isPoints ? 'any' : 1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Berapa ${unitLabel}?`}
              autoFocus
            />
            {mode === 'subtract' &&
              parsedAmount > currentValue &&
              parsedAmount > 0 && (
                <p className="mt-1 text-xs text-danger-600">
                  Tidak boleh lebih dari saldo saat ini (
                  {formatNumberId(currentValue)}).
                </p>
              )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Alasan <span className="text-danger-600">*</span>
            </label>
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isPoints
                  ? 'cth. Migrasi dari kartu kertas, atau koreksi kasir'
                  : 'cth. Migrasi dari kartu stempel kertas'
              }
              maxLength={200}
            />
            <p className="mt-0.5 text-xs text-gray-500">
              Tercatat di riwayat — tulis sejelas mungkin untuk audit nanti.
            </p>
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
          Batal
        </Button>
        <Button
          variant={mode === 'add' ? 'brand' : 'outline'}
          onClick={() => mut.mutate()}
          loading={mut.isPending}
          disabled={!canSave}
        >
          {mode === 'add' ? 'Tambah' : 'Kurangi'} {unitLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
