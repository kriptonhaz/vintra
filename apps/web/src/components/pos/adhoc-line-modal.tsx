import * as React from 'react'
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
import { CurrencyInput } from '@/components/ui/currency-input'

interface Props {
  open: boolean
  onClose: () => void
  onAdd: (input: { name: string; unitPrice: number; qty: number }) => void
}

export function AdhocLineModal({ open, onClose, onAdd }: Props) {
  const [name, setName] = React.useState('')
  const [priceStr, setPriceStr] = React.useState('')
  const [qty, setQty] = React.useState(1)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setName('')
      setPriceStr('')
      setQty(1)
      setError('')
    }
  }, [open])

  function handleAdd() {
    if (!name.trim()) {
      setError('Nama item wajib diisi')
      return
    }
    const price = parseInt(priceStr) || 0
    if (price <= 0) {
      setError('Harga harus lebih dari 0')
      return
    }
    if (qty <= 0) {
      setError('Jumlah harus lebih dari 0')
      return
    }
    onAdd({ name: name.trim(), unitPrice: price, qty })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Tambah Item Lain</DialogTitle>
        <DialogDescription>
          Item ini tidak akan mengurangi stok inventory. Cocok untuk jasa atau item satu kali.
        </DialogDescription>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-3">
          <Input
            label="Nama item"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth. Jasa antar"
          />
          <CurrencyInput
            label="Harga satuan"
            value={priceStr}
            onChange={setPriceStr}
          />
          <Input
            label="Jumlah"
            type="number"
            min={1}
            step="any"
            value={qty}
            onChange={(e) => setQty(parseFloat(e.target.value) || 1)}
          />
          {error && (
            <p className="text-sm text-danger-600">{error}</p>
          )}
        </div>
      </DialogContent>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Batal
        </Button>
        <Button variant="brand" onClick={handleAdd}>
          Tambah ke Keranjang
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
