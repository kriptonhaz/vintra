/**
 * Phone-first customer picker for the cashier (JUR-6 redesign).
 *
 * UX inspiration: Alfamart-style "member?" prompt at checkout. The
 * cashier types the customer's phone — if it matches, suggestions
 * surface and one tap attaches an existing record; if it doesn't, an
 * inline "Buat & Pasang" path lets the cashier create + attach in one
 * step. Skipping the modal entirely rings the sale as a walk-in (no
 * customer attached) — the previous always-visible card forced every
 * cashier to either fill or ignore those fields.
 *
 * Replaces the inline `CustomerCaptureBlock` that used to live in the
 * cart panel. Cart now shows just a compact button (when no customer
 * attached) or a chip with detach (when attached).
 */
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { User, Plus, Search } from 'lucide-react'
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
import { useToast } from '@/components/ui/toast'
import {
  searchCustomersByPhone,
  upsertCustomer,
} from '@/server/functions/customers'

export interface PickedCustomer {
  id?: string // null when the cashier hasn't created a row yet
  name: string
  phone: string // raw user input
}

interface Props {
  open: boolean
  /** Pre-fill phone from the cart's existing customerPhone state. */
  initialPhone?: string
  initialName?: string
  onClose: () => void
  /** Walk-in (no customer attached) — clears name + phone in caller. */
  onSkip: () => void
  /** Existing customer chosen, OR new customer just created. */
  onPick: (customer: PickedCustomer) => void
}

export function CustomerPickerModal({
  open,
  initialPhone = '',
  initialName = '',
  onClose,
  onSkip,
  onPick,
}: Props) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  // `query` holds the raw input — may be a phone number, a partial
  // name, or both. The server fn extracts digits internally for the
  // phone-ILIKE branch and uses the whole string for the name-ILIKE
  // branch (case-insensitive).
  const [query, setQuery] = React.useState('')
  const [name, setName] = React.useState('')
  const [debouncedQuery, setDebouncedQuery] = React.useState('')

  // Reset on open so a previous session's state doesn't bleed in.
  React.useEffect(() => {
    if (open) {
      setQuery(initialPhone)
      setName(initialName)
      setDebouncedQuery(initialPhone)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Debounce the search input before hitting the endpoint. 250ms
  // balances typed-then-pause UX with not hammering the server.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250)
    return () => clearTimeout(t)
  }, [query])

  const trimmedQuery = query.trim()
  const phoneDigits = trimmedQuery.replace(/\D/g, '')
  const debouncedTrimmed = debouncedQuery.trim()

  const suggestions = useQuery({
    queryKey: ['pos', 'customer-search', debouncedTrimmed],
    queryFn: () =>
      searchCustomersByPhone({ data: { query: debouncedTrimmed } }),
    enabled: open && debouncedTrimmed.length >= 3,
    staleTime: 30 * 1000,
  })

  const hasSuggestions = (suggestions.data?.length ?? 0) > 0
  const showCreateForm = phoneDigits.length >= 8 && !hasSuggestions

  const createMut = useMutation({
    mutationFn: () =>
      upsertCustomer({
        data: { name: name.trim(), phone: trimmedQuery },
      }),
    onSuccess: async (created) => {
      toast({ title: 'Pelanggan baru tersimpan', variant: 'success' })
      await queryClient.invalidateQueries({ queryKey: ['pos', 'customers'] })
      onPick({ id: created.id, name: created.name, phone: trimmedQuery })
    },
    onError: (err) => {
      toast({
        title: 'Gagal menyimpan',
        description: err instanceof Error ? err.message : 'Coba lagi.',
        variant: 'error',
      })
    },
  })

  function pickExisting(c: { id: string; name: string; phone: string | null }) {
    onPick({ id: c.id, name: c.name, phone: c.phone ?? trimmedQuery })
  }

  function handleSubmitCreate() {
    if (!name.trim()) {
      toast({
        title: 'Nama wajib diisi',
        description: 'Masukkan nama pelanggan untuk menyimpan.',
        variant: 'error',
      })
      return
    }
    createMut.mutate()
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Pelanggan</DialogTitle>
        <DialogDescription>
          Ketik nama atau nomor HP — pelanggan eksisting akan muncul, atau
          buat baru kalau belum terdaftar.
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4">
          {/* Combined search input — accepts a name or a phone. Server
              matches phone-digits ILIKE OR name ILIKE (case-insensitive). */}
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
              <Search className="h-4 w-4" />
              Nama atau No. HP / WhatsApp
            </label>
            <div className="relative">
              <Input
                type="text"
                inputMode="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="cth. Budi atau 08123456789"
                className="pr-9"
                autoFocus
              />
              {suggestions.isFetching && (
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-pulse text-gray-400" />
              )}
            </div>
            {trimmedQuery.length > 0 && trimmedQuery.length < 3 && (
              <p className="mt-1 text-xs text-gray-500">
                Ketik minimal 3 karakter untuk lookup.
              </p>
            )}
          </div>

          {/* Suggestions list — appears when matches exist */}
          {hasSuggestions && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                Pelanggan eksisting ({suggestions.data!.length})
              </p>
              <ul className="-mx-1 max-h-60 space-y-1 overflow-y-auto px-1">
                {suggestions.data!.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => pickExisting(c)}
                      className="flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-50/50 active:bg-brand-100/50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700/40"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                        <User className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                          {c.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          +{c.phone}
                          {c.visitCount > 0 && ` · ${c.visitCount}× kunjungan`}
                        </p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Inline create form — appears when phone is "complete" but
              no existing customer matches. Saves the cashier from
              juggling two flows: lookup-or-create happens in one place. */}
          {showCreateForm && !suggestions.isFetching && (
            <div className="rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/40 p-3 dark:border-brand-700 dark:bg-brand-900/10">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4 text-brand-600" />
                <span className="font-medium text-brand-900 dark:text-brand-200">
                  Pelanggan baru
                </span>
              </div>
              <p className="mb-3 text-xs text-brand-800 dark:text-brand-300">
                Nomor ini belum terdaftar. Isi nama dan langsung pasang
                ke transaksi ini.
              </p>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama pelanggan"
                autoComplete="off"
              />
              <Button
                variant="brand"
                size="lg"
                onClick={handleSubmitCreate}
                loading={createMut.isPending}
                disabled={!name.trim()}
                className="mt-3 w-full"
              >
                Simpan & Pasang ke Transaksi
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button
          variant="ghost"
          onClick={() => {
            onSkip()
          }}
        >
          Skip — Walk-in
        </Button>
        <Button variant="default" onClick={onClose}>
          Tutup
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
