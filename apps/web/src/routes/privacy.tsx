import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { LandingNavbar } from '@/components/layout/landing-navbar'
import { LandingFooter } from '@/components/layout/landing-footer'
import i18n from '@/lib/i18n' // JUR-138

export const Route = createFileRoute('/privacy')({
  head: () => ({
    meta: [
      { title: i18n.t('privacy.metaTitle') },
      { name: 'description', content: i18n.t('privacy.metaDescription') },
    ],
  }),
  component: PrivacyPage,
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

function PrivacyPage() {
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

  const collectedItems = t('privacy.collected.items', { returnObjects: true }) as BulletItem[]
  const usageItems = t('privacy.usage.items', { returnObjects: true }) as BulletItem[]
  const storageItems = t('privacy.storage.items', { returnObjects: true }) as BulletItem[]
  const sharingItems = t('privacy.sharing.items', { returnObjects: true }) as BulletItem[]
  const cookiesItems = t('privacy.cookies.items', { returnObjects: true }) as BulletItem[]
  const rightsItems = t('privacy.rights.items', { returnObjects: true }) as BulletItem[]
  const retentionItems = t('privacy.retention.items', { returnObjects: true }) as BulletItem[]
  const changesItems = t('privacy.changes.items', { returnObjects: true }) as BulletItem[]

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <LandingNavbar />
      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-4 pt-28 pb-20 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl">
            {t('privacy.title')}
          </h1>
          <p className="mt-2 text-sm text-gray-500">{t('privacy.effectiveDate')}</p>

          <div className="mt-8 space-y-8">
            <Section heading={t('privacy.intro.heading')}>
              <p className="mb-4 text-base leading-relaxed text-gray-600">
                {t('privacy.intro.p1')}
              </p>
              <p className="text-base leading-relaxed text-gray-600">
                {t('privacy.intro.p2')}
              </p>
            </Section>

            <Section heading={t('privacy.collected.heading')}>
              <Lead>{t('privacy.collected.lead')}</Lead>
              <Bullets items={collectedItems} />
            </Section>

            <Section heading={t('privacy.usage.heading')}>
              <Lead>{t('privacy.usage.lead')}</Lead>
              <Bullets items={usageItems} />
            </Section>

            <Section heading={t('privacy.storage.heading')}>
              <Lead>{t('privacy.storage.lead')}</Lead>
              <Bullets items={storageItems} />
            </Section>

            <Section heading={t('privacy.sharing.heading')}>
              <Lead>{t('privacy.sharing.lead')}</Lead>
              <Bullets items={sharingItems} />
            </Section>

            <Section heading={t('privacy.cookies.heading')}>
              <Lead>{t('privacy.cookies.lead')}</Lead>
              <Bullets items={cookiesItems} />
            </Section>

            <Section heading={t('privacy.rights.heading')}>
              <Lead>{t('privacy.rights.lead')}</Lead>
              <Bullets items={rightsItems} />
              <p className="mt-4 text-base leading-relaxed text-gray-600">
                <Trans
                  i18nKey="privacy.rights.contact"
                  components={{ emaillink: <EmailLink /> }}
                />
              </p>
            </Section>

            <Section heading={t('privacy.retention.heading')}>
              <Bullets items={retentionItems} />
            </Section>

            <Section heading={t('privacy.children.heading')}>
              <p className="text-base leading-relaxed text-gray-600">
                {t('privacy.children.body')}
              </p>
            </Section>

            <Section heading={t('privacy.changes.heading')}>
              <Lead>{t('privacy.changes.lead')}</Lead>
              <Bullets items={changesItems} />
              <p className="mt-4 text-base leading-relaxed text-gray-600">
                {t('privacy.changes.reminder')}
              </p>
            </Section>

            <Section heading={t('privacy.contact.heading')}>
              <p className="text-base leading-relaxed text-gray-600">
                <Trans
                  i18nKey="privacy.contact.body"
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
