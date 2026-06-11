import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { completeOnboarding } from '@/server/functions/auth'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { BUSINESS_CATEGORIES, EMPLOYEE_RANGES } from '@/lib/constants'
import logo from '@/assets/images/logo.png'
import { Store, Users, Briefcase, Phone } from 'lucide-react'

export const Route = createFileRoute('/_authed/onboarding')({
  component: OnboardingPage,
})

const categoryOptions = BUSINESS_CATEGORIES.map((c) => ({ value: c, label: c }))
const employeeOptions = EMPLOYEE_RANGES.map((r) => ({ value: r, label: r }))

function OnboardingPage() {
  const { user } = Route.useRouteContext()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const router = useRouter()

  const [businessName, setBusinessName] = useState(user.tenant?.businessName ?? '')
  const [businessCategory, setBusinessCategory] = useState('')
  const [employeeRange, setEmployeeRange] = useState('')
  const [phone, setPhone] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  function validate() {
    const newErrors: Record<string, string> = {}
    if (!businessName.trim()) newErrors.businessName = t('validation.productNameRequired')
    if (!businessCategory) newErrors.businessCategory = t('validation.categoryRequired')
    if (!employeeRange) newErrors.employeeRange = t('validation.categoryRequired')
    const trimmedPhone = phone.trim()
    if (trimmedPhone.length < 8 || trimmedPhone.length > 20) {
      newErrors.phone = 'Nomor HP tidak valid'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    try {
      await completeOnboarding({
        data: {
          businessName: businessName.trim(),
          businessCategory,
          employeeRange,
          phone: phone.trim(),
        },
      })
      await router.invalidate()
      navigate({ to: '/dashboard' })
    } catch {
      // handled by form
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 dark:bg-gray-900">
      <div className="w-full max-w-md">
        {/* Logo + Heading */}
        <div className="mb-8 text-center">
          <img src={logo} alt="Vintra" className="mx-auto mb-4 h-14 w-14" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('onboarding.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {t('onboarding.subtitle')}
          </p>
        </div>

        {/* Form Card */}
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Business Name */}
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Store className="h-4 w-4 text-brand-500" />
                {t('onboarding.businessName')}
              </div>
              <Input
                placeholder={t('onboarding.businessNamePlaceholder')}
                value={businessName}
                onChange={(e) => {
                  setBusinessName(e.target.value)
                  if (errors.businessName) setErrors((prev) => ({ ...prev, businessName: '' }))
                }}
                error={errors.businessName}
              />
            </div>

            {/* Business Category */}
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Briefcase className="h-4 w-4 text-brand-500" />
                {t('onboarding.businessCategory')}
              </div>
              <Select
                options={categoryOptions}
                placeholder={t('onboarding.businessCategoryPlaceholder')}
                value={businessCategory}
                onChange={(e) => {
                  setBusinessCategory(e.target.value)
                  if (errors.businessCategory) setErrors((prev) => ({ ...prev, businessCategory: '' }))
                }}
                error={errors.businessCategory}
              />
            </div>

            {/* Employee Range */}
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Users className="h-4 w-4 text-brand-500" />
                {t('onboarding.employeeRange')}
              </div>
              <Select
                options={employeeOptions}
                placeholder={t('onboarding.employeeRangePlaceholder')}
                value={employeeRange}
                onChange={(e) => {
                  setEmployeeRange(e.target.value)
                  if (errors.employeeRange) setErrors((prev) => ({ ...prev, employeeRange: '' }))
                }}
                error={errors.employeeRange}
              />
            </div>

            {/* Phone */}
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                <Phone className="h-4 w-4 text-brand-500" />
                {t('onboarding.phone')}
              </div>
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t('onboarding.phonePlaceholder')}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value)
                  if (errors.phone) setErrors((prev) => ({ ...prev, phone: '' }))
                }}
                error={errors.phone}
              />
            </div>

            {/* Submit */}
            <Button
              type="submit"
              variant="brand"
              className="w-full"
              size="lg"
              loading={loading}
            >
              {t('onboarding.submit')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
