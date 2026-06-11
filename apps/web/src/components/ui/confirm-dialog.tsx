import * as React from 'react'
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from './dialog'
import { Button } from './button'

interface ConfirmDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  variant?: 'default' | 'danger'
  loading?: boolean
}

function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmText = 'Konfirmasi',
  cancelText = 'Batal',
  variant = 'default',
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <DialogContent className="pt-2">
        {/* Content area left intentionally minimal for confirmation dialogs */}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={loading}>
          {cancelText}
        </Button>
        <Button
          variant={variant === 'danger' ? 'danger' : 'default'}
          onClick={onConfirm}
          loading={loading}
        >
          {confirmText}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export { ConfirmDialog, type ConfirmDialogProps }
