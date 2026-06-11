import { createFileRoute, Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Lock, Clock, LogOut, CalendarX, Sparkles, MessageCircle } from 'lucide-react'
import { usePermissions } from '@/hooks/use-permissions'
import { useAuth } from '@/hooks/use-auth'
import { ATTENDANCE_TRIAL_DEFAULTS } from '@vintra/shared'
import { formatDate } from '@/lib/utils' // JUR-137
import { buildSalesWaUrl } from '@/lib/constants' // JUR-127

export const Route = createFileRoute('/_authed/attendance/locked')({
  component: LockedPage,
})

function LockedPage() {
  const { t } = useTranslation()
  const { has } = usePermissions()
  const { signOut } = useAuth()
  const navigate = useNavigate()

  // Pull enriched user context (incl. moduleSubscriptions) from the
  // _authed parent route.
  const parentCtx = useRouteContext({ from: '/_authed' })
  const sub = parentCtx.user?.moduleSubscriptions?.attendance

  // Three distinct states with distinct copy:
  //   1. Trial-ended — trial was used, has ended, no paid subscription.
  //   2. Paid-expired — was paying, subscription expired (no trial info).
  //   3. Never-subscribed — nothing has ever been set up for this tenant.
  const paidActive = sub ? sub.active && !sub.isExpired : false
  const trialEndedAt =
    sub?.trialUsed && !sub.trialActive && !paidActive && sub.trialEndsAt
      ? new Date(sub.trialEndsAt)
      : null
  const paidExpiredAt =
    !trialEndedAt && sub?.isExpired && sub.expiresAt
      ? new Date(sub.expiresAt)
      : null

  // Only users with at least hpp.read have a functional /dashboard;
  // staff-only accounts would just loop back here, so give them a
  // logout button instead.
  const canReturnToDashboard = has('hpp.read')

  // Offer the trial only when it's genuinely available:
  // - Hide if the tenant already used their one-shot trial
  // - Hide on trial-ended state (trial_used = true)
  // - Hide on paid-expired state — renewal is the relevant ask there
  // - Hide for staff accounts (they don't decide; owner does)
  const canOfferTrial =
    !sub?.trialUsed &&
    !trialEndedAt &&
    !paidExpiredAt &&
    canReturnToDashboard

  const trialWaHref = buildSalesWaUrl(
    `Halo Vintra, saya ingin mencoba trial modul Absensi ${ATTENDANCE_TRIAL_DEFAULTS.durationDays} hari.`,
  )

  async function handleLogout() {
    await signOut()
    navigate({ to: '/auth/login' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-12">
      <div className="rounded-xl border border-gray-200 bg-white p-10 text-center dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400">
          {trialEndedAt || paidExpiredAt ? (
            <CalendarX className="h-8 w-8" />
          ) : (
            <Lock className="h-8 w-8" />
          )}
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {trialEndedAt
            ? t('attendance.lockedTrialEndedTitle')
            : paidExpiredAt
              ? t('attendance.lockedExpiredTitle')
              : t('attendance.lockedTitle')}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-gray-600 dark:text-gray-400">
          {trialEndedAt
            ? t('attendance.lockedTrialEndedBody', {
                date: formatDate(trialEndedAt, 'dd MMMM yyyy'),
              })
            : paidExpiredAt
              ? t('attendance.lockedExpiredBody', {
                  date: formatDate(paidExpiredAt, 'dd MMMM yyyy'),
                })
              : canReturnToDashboard
                ? t('attendance.lockedBody')
                : t('attendance.lockedBodyStaff')}
        </p>
        <div className="mx-auto mt-6 flex max-w-sm items-center justify-center gap-2 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-800 dark:bg-brand-900/20 dark:text-brand-300">
          <Clock className="h-4 w-4" />
          <span>
            <strong>Rp 5.000</strong> {t('attendance.lockedPricePerStaff')}
          </span>
        </div>

        {canOfferTrial && (
          <div className="mx-auto mt-4 max-w-sm rounded-lg border border-accent-200 bg-accent-50 p-4 dark:border-accent-900 dark:bg-accent-900/20">
            <div className="mb-2 flex items-center justify-center gap-1.5 text-sm font-semibold text-accent-800 dark:text-accent-300">
              <Sparkles className="h-4 w-4" />
              {t('attendance.lockedTrialOfferTitle', {
                days: ATTENDANCE_TRIAL_DEFAULTS.durationDays,
              })}
            </div>
            <p className="text-xs text-accent-700 dark:text-accent-400">
              {t('attendance.lockedTrialOfferBody', {
                days: ATTENDANCE_TRIAL_DEFAULTS.durationDays,
              })}
            </p>
            <a
              href={trialWaHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1EBE57]"
            >
              <MessageCircle className="h-4 w-4" />
              {t('attendance.lockedTrialOfferCta')}
            </a>
          </div>
        )}

        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">
          {t('attendance.lockedContact')}
        </p>
        {canReturnToDashboard ? (
          <Link
            to="/dashboard"
            className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            {t('attendance.lockedBackToDashboard')}
          </Link>
        ) : (
          <button
            type="button"
            onClick={handleLogout}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline dark:text-brand-400"
          >
            <LogOut className="h-4 w-4" />
            {t('layout.logout')}
          </button>
        )}
      </div>
    </div>
  )
}
