import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import i18n from '@/lib/i18n' // JUR-138

export const Route = createFileRoute('/terms')({
  head: () => ({
    meta: [
      { title: i18n.t('terms.metaTitle') },
      { name: 'description', content: i18n.t('terms.metaDescription') },
    ],
  }),
  component: TermsPage,
})

type BulletItem = string | { term: string; desc: string }

function Section({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="mt-10 mb-4 text-xl font-semibold text-gray-900">{heading}</h2>
      {children}
    </section>
  )
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 text-base leading-relaxed text-gray-600">{children}</p>
  )
}

function Bullets({ items }: { items: BulletItem[] }) {
  return (
    <ul className="list-disc space-y-2 pl-6 text-base leading-relaxed text-gray-600">
      {items.map((item, i) => (
        <li key={i}>
          {typeof item === 'string' ? (
            item
          ) : item.term ? (
            <>
              <strong>{item.term}</strong> — {item.desc}
            </>
          ) : (
            item.desc
          )}
        </li>
      ))}
    </ul>
  )
}

function EmailLink({ children }: { children?: React.ReactNode }) {
  return (
    <a
      href="mailto:support@vintra.my.id"
      className="text-brand-600 underline hover:text-brand-700"
    >
      {children}
    </a>
  )
}

function TermsPage() {
  const { t } = useTranslation()

  // Force light mode — dark mode is only for app pages
  useEffect(() => {
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')
    if (wasDark) root.classList.remove('dark')
    return () => {
      if (wasDark) root.classList.add('dark')
    }
  }, [])

  const definitionsItems = t('terms.definitions.items', { returnObjects: true }) as BulletItem[]
  const requirementsItems = t('terms.requirements.items', { returnObjects: true }) as BulletItem[]
  const accountItems = t('terms.account.items', { returnObjects: true }) as BulletItem[]
  const accountTrailing = t('terms.account.trailingItems', { returnObjects: true }) as BulletItem[]
  const usageRulesItems = t('terms.usageRules.items', { returnObjects: true }) as BulletItem[]
  const paymentItems = t('terms.payment.items', { returnObjects: true }) as BulletItem[]
  const liabilityItems = t('terms.liability.items', { returnObjects: true }) as BulletItem[]
  const terminationItems = t('terms.termination.items', { returnObjects: true }) as BulletItem[]
  const changesItems = t('terms.changes.items', { returnObjects: true }) as BulletItem[]

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <LandingNavbar />
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 pt-28 pb-20 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {t('terms.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-500">{t('terms.effectiveDate')}</p>

          <div className="mt-8 space-y-8">
            <Section heading={t('terms.intro.heading')}>
              <p className="mb-4 text-base leading-relaxed text-gray-600">
                {t('terms.intro.p1')}
              </p>
              <p className="text-base leading-relaxed text-gray-600">
                {t('terms.intro.p2')}
              </p>
            </Section>

            <Section heading={t('terms.definitions.heading')}>
              <Lead>{t('terms.definitions.lead')}</Lead>
              <Bullets items={definitionsItems} />
            </Section>

            <Section heading={t('terms.requirements.heading')}>
              <Lead>{t('terms.requirements.lead')}</Lead>
              <Bullets items={requirementsItems} />
            </Section>

            <Section heading={t('terms.account.heading')}>
              <Lead>{t('terms.account.lead')}</Lead>
              <ul className="list-disc space-y-2 pl-6 text-base leading-relaxed text-gray-600">
                {accountItems.map((item, i) => (
                  <li key={`a-${i}`}>{typeof item === 'string' ? item : item.desc}</li>
                ))}
                <li>
                  <Trans
                    i18nKey="terms.account.contactBullet"
                    components={{ emaillink: <EmailLink /> }}
                  />
                </li>
                {accountTrailing.map((item, i) => (
                  <li key={`t-${i}`}>{typeof item === 'string' ? item : item.desc}</li>
                ))}
              </ul>
            </Section>

            <Section heading={t('terms.usageRules.heading')}>
              <Lead>{t('terms.usageRules.lead')}</Lead>
              <Bullets items={usageRulesItems} />
            </Section>

            <Section heading={t('terms.ip.heading')}>
              <p className="mb-4 text-base leading-relaxed text-gray-600">
                {t('terms.ip.p1')}
              </p>
              <p className="text-base leading-relaxed text-gray-600">
                {t('terms.ip.p2')}
              </p>
            </Section>

            <Section heading={t('terms.payment.heading')}>
              <Lead>{t('terms.payment.lead')}</Lead>
              <Bullets items={paymentItems} />
            </Section>

            <Section heading={t('terms.liability.heading')}>
              <Lead>{t('terms.liability.lead')}</Lead>
              <Bullets items={liabilityItems} />
              <p className="mt-4 text-base leading-relaxed text-gray-600">
                {t('terms.liability.limitation')}
              </p>
            </Section>

            <Section heading={t('terms.termination.heading')}>
              <Bullets items={terminationItems} />
            </Section>

            <Section heading={t('terms.changes.heading')}>
              <Lead>{t('terms.changes.lead')}</Lead>
              <Bullets items={changesItems} />
              <p className="mt-4 text-base leading-relaxed text-gray-600">
                {t('terms.changes.continuation')}
              </p>
            </Section>

            <Section heading={t('terms.law.heading')}>
              <p className="text-base leading-relaxed text-gray-600">
                {t('terms.law.body')}
              </p>
            </Section>

            <Section heading={t('terms.contactSection.heading')}>
              <p className="text-base leading-relaxed text-gray-600">
                <Trans
                  i18nKey="terms.contactSection.body"
                  components={{ emaillink: <EmailLink /> }}
                />
              </p>
            </Section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}
