/**
 * SEO `<head>` builders for the public tenant site (JUR-177).
 *
 * The index route's `head()` is host-aware: on a claimed tenant
 * subdomain it calls `buildPublicSiteHead` to emit per-tenant title,
 * meta description, Open Graph + Twitter cards, a robots directive,
 * and a `LocalBusiness` JSON-LD block. Apex / 404 keep the root
 * route's marketing defaults.
 */

export interface PublicSiteBranch {
  name: string
  address: string | null
  isMain: boolean
}

export interface PublicSiteSeoInput {
  slug: string
  businessName: string
  seo: {
    title: string
    description: string | null
    ogImageUrl: string | null
    /**
     * First hero image's signed URL. When present, the head emits a
     * `<link rel="preload" as="image" fetchpriority="high">` so the
     * browser can start fetching the LCP image in parallel with the
     * JS bundles instead of waiting for body parse to discover the
     * `<img>` tag.
     */
    firstHeroImageUrl: string | null
    /** False when the site is unpublished or in maintenance — emits robots=noindex. */
    indexable: boolean
  }
  branches: PublicSiteBranch[]
}

export interface PublicSiteHead {
  meta: Array<Record<string, string>>
  links?: Array<Record<string, string>>
  scripts: Array<{ type: string; children: string }>
}

/** The canonical public URL for a tenant subdomain. */
export function tenantSiteUrl(slug: string): string {
  return `https://${slug}.vintra.my.id`
}

/**
 * Build the meta + script entries for a tenant subdomain's `<head>`.
 * Returns shapes ready to spread into TanStack Router's `head()`.
 */
export function buildPublicSiteHead(input: PublicSiteSeoInput): PublicSiteHead {
  const { slug, businessName, seo, branches } = input
  const url = tenantSiteUrl(slug)
  const title = seo.title || businessName
  const description = seo.description ?? undefined

  const meta: Array<Record<string, string>> = [{ title }]

  // Crawlers: an unpublished or maintenance site must not be indexed.
  meta.push({
    name: 'robots',
    content: seo.indexable ? 'index,follow' : 'noindex,nofollow',
  })

  if (description) {
    meta.push({ name: 'description', content: description })
  }

  // Open Graph
  meta.push({ property: 'og:type', content: 'website' })
  meta.push({ property: 'og:site_name', content: 'Vintra' })
  meta.push({ property: 'og:title', content: title })
  meta.push({ property: 'og:url', content: url })
  if (description) {
    meta.push({ property: 'og:description', content: description })
  }
  if (seo.ogImageUrl) {
    meta.push({ property: 'og:image', content: seo.ogImageUrl })
  }

  // Twitter card
  meta.push({
    name: 'twitter:card',
    content: seo.ogImageUrl ? 'summary_large_image' : 'summary',
  })
  meta.push({ name: 'twitter:title', content: title })
  if (description) {
    meta.push({ name: 'twitter:description', content: description })
  }
  if (seo.ogImageUrl) {
    meta.push({ name: 'twitter:image', content: seo.ogImageUrl })
  }

  // Preload the first hero image — without this, the browser can't
  // start fetching the LCP image until it parses the body and finds
  // the <img>. The Hero component already sets loading=eager +
  // fetchPriority=high on the <img>, but it can only do so once the
  // tag is discovered. The preload link in <head> closes that gap.
  const links: Array<Record<string, string>> = []
  if (seo.firstHeroImageUrl) {
    links.push({
      rel: 'preload',
      as: 'image',
      href: seo.firstHeroImageUrl,
      fetchPriority: 'high',
    })
  }

  return {
    meta,
    ...(links.length > 0 ? { links } : {}),
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify(
          buildLocalBusinessJsonLd({ slug, businessName, seo, branches }),
        ),
      },
    ],
  }
}

/**
 * `LocalBusiness` structured data — lets Google show the tenant as a
 * rich result (name, address, image). Kept deliberately minimal: only
 * fields we can populate reliably. Telephone / opening hours / price
 * range are omitted rather than guessed — a partial-but-correct
 * LocalBusiness still validates and indexes.
 */
export function buildLocalBusinessJsonLd(
  input: PublicSiteSeoInput,
): Record<string, unknown> {
  const { slug, businessName, seo, branches } = input
  const mainBranch =
    branches.find((b) => b.isMain) ?? branches[0] ?? null

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: businessName,
    url: tenantSiteUrl(slug),
  }
  if (seo.ogImageUrl) {
    jsonLd.image = seo.ogImageUrl
  }
  if (mainBranch?.address) {
    jsonLd.address = {
      '@type': 'PostalAddress',
      streetAddress: mainBranch.address,
      addressCountry: 'ID',
    }
  }
  return jsonLd
}
