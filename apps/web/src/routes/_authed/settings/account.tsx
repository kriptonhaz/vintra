import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff } from 'lucide-react'
import {
  changePasswordSchema,
  setPasswordSchema,
  type ChangePasswordInput,
  type SetPasswordInput,
} from '@vintra/shared'
import { changePassword, setPassword } from '@/server/functions/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { PushOptIn } from '@/components/notifications/push-opt-in'

export const Route = createFileRoute('/_authed/settings/account')({
  component: AccountPage,
})

function AccountPage() {
  const { user } = Route.useRouteContext()
  const { t } = useTranslation()

  const initials = (user.fullName ?? user.email)
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t('account.title')}
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {t('account.subtitle')}
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-700 dark:bg-brand-900/30 dark:text-brand-400">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-gray-900 dark:text-gray-100">
              {user.fullName ?? user.email}
            </p>
            <p className="truncate text-sm text-gray-500 dark:text-gray-400">
              {user.email}
            </p>
          </div>
        </div>

        <div className="mt-6 border-t border-gray-200 pt-4 dark:border-gray-700">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {t('account.providersTitle')}
          </p>
          <div className="flex flex-wrap gap-2">
            {user.authProviders.email && (
              <ProviderPill label={t('account.providerEmail')} />
            )}
            {user.authProviders.google && (
              <ProviderPill label={t('account.providerGoogle')} />
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('account.pushTitle')}
        </h2>
        <p className="mt-1 mb-4 text-sm text-gray-600 dark:text-gray-400">
          {t('account.pushSubtitle')}
        </p>
        <PushOptIn />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t('account.passwordSection')}
        </h2>
        {user.authProviders.email ? (
          <ChangePasswordForm />
        ) : (
          <SetPasswordForm />
        )}
      </div>
    </div>
  )
}

function ProviderPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-200">
      {label}
    </span>
  )
}

function PasswordField({
  label,
  hint,
  error,
  registerProps,
  showAriaLabel,
  hideAriaLabel,
}: {
  label: string
  hint?: string
  error?: string
  registerProps: ReturnType<ReturnType<typeof useForm>['register']>
  showAriaLabel: string
  hideAriaLabel: string
}) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <div className="relative">
        <Input
          type={shown ? 'text' : 'password'}
          autoComplete="off"
          error={error}
          className="pr-10"
          {...registerProps}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? hideAriaLabel : showAriaLabel}
          // top-1/2 + -translate-y-1/2 centers it on the input even with
          // an error message rendered below; placing it inside Input's
          // outer flex would shift it on validation error.
          className="absolute right-2 top-5 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && !error && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      )}
    </div>
  )
}

function ChangePasswordForm() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(values: ChangePasswordInput) {
    try {
      await changePassword({ data: values })
      toast({
        title: t('account.passwordUpdatedToast'),
        variant: 'success',
      })
      form.reset()
      // Refresh current-user so the page state stays consistent.
      await queryClient.invalidateQueries({ queryKey: ['current-user'] })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('account.passwordUpdateFailed')
      toast({
        title: t('common.toastFailedTitle'),
        description: message,
        variant: 'error',
      })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t('account.changePasswordDesc')}
      </p>

      <PasswordField
        label={t('account.fieldCurrentPassword')}
        error={form.formState.errors.currentPassword?.message}
        registerProps={form.register('currentPassword')}
        showAriaLabel={t('account.showPassword')}
        hideAriaLabel={t('account.hidePassword')}
      />
      <PasswordField
        label={t('account.fieldNewPassword')}
        hint={t('account.passwordHint')}
        error={form.formState.errors.newPassword?.message}
        registerProps={form.register('newPassword')}
        showAriaLabel={t('account.showPassword')}
        hideAriaLabel={t('account.hidePassword')}
      />
      <PasswordField
        label={t('account.fieldConfirmPassword')}
        error={form.formState.errors.confirmPassword?.message}
        registerProps={form.register('confirmPassword')}
        showAriaLabel={t('account.showPassword')}
        hideAriaLabel={t('account.hidePassword')}
      />

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          variant="brand"
          loading={form.formState.isSubmitting}
        >
          {t('account.submitChange')}
        </Button>
      </div>
    </form>
  )
}

function SetPasswordForm() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const form = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  })

  async function onSubmit(values: SetPasswordInput) {
    try {
      await setPassword({ data: values })
      toast({
        title: t('account.passwordSetToast'),
        variant: 'success',
      })
      form.reset()
      // Refresh current-user — authProviders.email flips to true after
      // a successful set-password, which swaps this form for the
      // change-password variant on the next render.
      await queryClient.invalidateQueries({ queryKey: ['current-user'] })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t('account.passwordUpdateFailed')
      toast({
        title: t('common.toastFailedTitle'),
        description: message,
        variant: 'error',
      })
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="mt-4 space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t('account.setPasswordIntro')}
      </p>

      <PasswordField
        label={t('account.fieldNewPassword')}
        hint={t('account.passwordHint')}
        error={form.formState.errors.newPassword?.message}
        registerProps={form.register('newPassword')}
        showAriaLabel={t('account.showPassword')}
        hideAriaLabel={t('account.hidePassword')}
      />
      <PasswordField
        label={t('account.fieldConfirmPassword')}
        error={form.formState.errors.confirmPassword?.message}
        registerProps={form.register('confirmPassword')}
        showAriaLabel={t('account.showPassword')}
        hideAriaLabel={t('account.hidePassword')}
      />

      <div className="flex justify-end pt-2">
        <Button
          type="submit"
          variant="brand"
          loading={form.formState.isSubmitting}
        >
          {t('account.submitSet')}
        </Button>
      </div>
    </form>
  )
}
