import { useEffect, useRef, useState } from 'react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { QrCode, Power, X } from 'lucide-react'
import { listBranches } from '@/server/functions/attendance-branches'
import {
  startQrHost,
  rotateQrToken,
  stopQrHost,
} from '@/server/functions/attendance-qr-host'
import { Button } from '@/components/ui/button'
import { ModuleBreadcrumb } from '@/components/layout/module-breadcrumb'
import { useBranch } from '@/hooks/use-branch'
import { useToast } from '@/components/ui/toast'

export const Route = createFileRoute('/_authed/attendance/qr-host')({
  beforeLoad: ({ context }) => {
    const user = (context as { user?: { permissions?: string[] } }).user
    if (!user?.permissions?.includes('attendance.manage')) {
      throw redirect({ to: '/attendance' })
    }
  },
  loader: () => listBranches(),
  component: QrHostPage,
})

function QrHostPage() {
  const branches = Route.useLoaderData()
  const { t } = useTranslation()
  const { toast } = useToast()

  // Branch comes from the global topbar switcher — single source of truth.
  const { selectedBranchId } = useBranch()
  const [hosting, setHosting] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<Date | null>(null)
  const [rotationSeconds, setRotationSeconds] = useState(30)
  const [remaining, setRemaining] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const rotateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const selectedBranch = branches.find((b) => b.id === selectedBranchId)

  async function refreshToken() {
    try {
      const { token, expiresAt: expIso, rotationSeconds: rot } = await rotateQrToken()
      const dataUrl = await QRCode.toDataURL(token, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 480,
      })
      setQrDataUrl(dataUrl)
      setExpiresAt(new Date(expIso))
      setRotationSeconds(rot)

      // Schedule next refresh just before expiry
      if (rotateTimer.current) clearTimeout(rotateTimer.current)
      rotateTimer.current = setTimeout(() => {
        void refreshToken()
      }, Math.max(1000, (rot - 2) * 1000))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui QR')
    }
  }

  async function start() {
    if (!selectedBranchId) return
    setError(null)
    try {
      await startQrHost({ data: { branchId: selectedBranchId } })
      setHosting(true)
      await refreshToken()
      toast({
        title: t('common.toastSavedTitle'),
        description: t('qrHost.toastStarted', {
          branch: selectedBranch?.name ?? '',
        }),
        variant: 'success',
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memulai host'
      setError(msg)
      toast({
        title: t('common.toastFailedTitle'),
        description: msg,
        variant: 'error',
      })
    }
  }

  async function stop() {
    try {
      if (rotateTimer.current) clearTimeout(rotateTimer.current)
      if (tickTimer.current) clearInterval(tickTimer.current)
      rotateTimer.current = null
      tickTimer.current = null
      await stopQrHost()
    } catch {
      // ignore — we want the local state reset regardless
    } finally {
      setHosting(false)
      setQrDataUrl(null)
      setExpiresAt(null)
      setRemaining(0)
    }
  }

  // Tick remaining seconds for the countdown display
  useEffect(() => {
    if (!hosting || !expiresAt) return
    if (tickTimer.current) clearInterval(tickTimer.current)
    tickTimer.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 1000))
      setRemaining(left)
    }, 250)
    return () => {
      if (tickTimer.current) clearInterval(tickTimer.current)
    }
  }, [hosting, expiresAt])

  useEffect(() => {
    return () => {
      if (rotateTimer.current) clearTimeout(rotateTimer.current)
      if (tickTimer.current) clearInterval(tickTimer.current)
    }
  }, [])

  return (
    <div className="space-y-6">
      <ModuleBreadcrumb />

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('qrHost.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('qrHost.subtitle')}
        </p>
      </div>

      {!hosting ? (
        <div className="max-w-md space-y-4 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('qrHost.branchLabel')}
            </p>
            <p className="mt-1 text-base font-semibold text-gray-900 dark:text-gray-100">
              {selectedBranch?.name ?? '—'}
            </p>
          </div>
          <Button
            type="button"
            variant="brand"
            size="lg"
            onClick={start}
            disabled={!selectedBranchId}
            className="w-full"
          >
            <Power className="h-5 w-5" />
            {t('qrHost.startBtn')}
          </Button>
          {error && <p className="text-sm text-danger-600">{error}</p>}
          {branches.length === 0 && (
            <p className="text-sm text-warning-700 dark:text-warning-300">
              {t('qrHost.noBranch')}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <div className="text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('qrHost.hostingFor')}
            </p>
            <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {selectedBranch?.name}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-md">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR Code" className="h-64 w-64" />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center text-gray-400">
                <QrCode className="h-12 w-12 animate-pulse" />
              </div>
            )}
          </div>

          <div className="text-center">
            <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
              {t('qrHost.expiresIn')}
            </p>
            <p
              className={`text-3xl font-bold tabular-nums ${
                remaining <= 5
                  ? 'text-danger-600 dark:text-danger-400'
                  : 'text-brand-600 dark:text-brand-400'
              }`}
            >
              {remaining}s
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('qrHost.rotationHint', { seconds: rotationSeconds })}
            </p>
          </div>

          <Button type="button" variant="outline" onClick={stop}>
            <X className="h-4 w-4" />
            {t('qrHost.stopBtn')}
          </Button>

          {error && <p className="text-sm text-danger-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
