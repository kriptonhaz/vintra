/**
 * Starter presets — initial `{ theme, sections, seo }` configurations
 * a tenant picks from. Replaces the fixed "templates" of v1.
 *
 * Critically: applying a preset OVERWRITES the current draft. Tenants
 * can't preview without affecting their draft (we accept the risk —
 * the editor warns before applying).
 *
 * Each preset's `build()` is called fresh so generated UUIDs don't
 * collide. The id generator is injected so server-side code can use
 * `randomUUID()` from `node:crypto` while client-side code uses
 * `crypto.randomUUID()` from the Web Crypto API — same shape, no
 * coupling.
 */
import type { SitePreset, SiteSettingsV2 } from '../v2-types'

type IdGen = () => string

const sec = (idGen: IdGen, type: string, enabled = true, settings: Record<string, unknown> = {}) => ({
  id: idGen(),
  type,
  enabled,
  settings,
})

// ─── Universal ───────────────────────────────────────────────────────

function miniPreset(idGen: IdGen): SiteSettingsV2 {
  return {
    theme: { brandColor: '#2563EB', accent: '#DBEAFE', font: 'inter' },
    sections: [
      sec(idGen, 'hero', true, { layout: 'color-bg', ctaText: 'Hubungi Kami', ctaAction: 'whatsapp' }),
      sec(idGen, 'services', true, { layout: 'list' }),
      sec(idGen, 'hours', true, {}),
      sec(idGen, 'contact', true, {}),
      sec(idGen, 'footer', true, {}),
    ],
    seo: { title: '', description: '', ogImageAssetKey: null },
  }
}

// ─── F&B — Warung Modern ─────────────────────────────────────────────

function warungModernPreset(idGen: IdGen): SiteSettingsV2 {
  return {
    theme: { brandColor: '#EA580C', accent: '#FED7AA', font: 'poppins' },
    sections: [
      sec(idGen, 'hero', true, {
        layout: 'color-bg',
        ctaText: 'Pesan Sekarang',
        ctaAction: 'whatsapp',
        tagline: 'Masakan rumahan, harga warung.',
      }),
      sec(idGen, 'services', true, { layout: 'grid', heading: 'Menu Kami', showDuration: false }),
      sec(idGen, 'about', true, { layout: 'centered', heading: 'Cerita Kami' }),
      sec(idGen, 'hours', true, {}),
      sec(idGen, 'maps', true, {}),
      sec(idGen, 'contact', true, { heading: 'Pesan Sekarang' }),
      sec(idGen, 'footer', true, {}),
    ],
    seo: { title: '', description: '', ogImageAssetKey: null },
  }
}

// ─── F&B — Kafe / Resto ──────────────────────────────────────────────

function kafeRestoPreset(idGen: IdGen): SiteSettingsV2 {
  return {
    theme: { brandColor: '#92400E', accent: '#FDE68A', font: 'lora' },
    sections: [
      sec(idGen, 'hero', true, {
        layout: 'image-bg',
        ctaText: 'Reservasi',
        ctaAction: 'whatsapp',
        tagline: 'Tempat nongkrong dengan kopi terbaik.',
      }),
      sec(idGen, 'about', true, { layout: 'side-by-side' }),
      sec(idGen, 'services', true, { layout: 'list', heading: 'Menu' }),
      sec(idGen, 'gallery', true, { heading: 'Suasana', columns: '3' }),
      sec(idGen, 'hours', true, {}),
      sec(idGen, 'maps', true, { heading: 'Kunjungi Kami' }),
      sec(idGen, 'contact', true, { heading: 'Reservasi Meja' }),
      sec(idGen, 'footer', true, {}),
    ],
    seo: { title: '', description: '', ogImageAssetKey: null },
  }
}

// ─── Retail — Toko ───────────────────────────────────────────────────

function tokoRetailPreset(idGen: IdGen): SiteSettingsV2 {
  return {
    theme: { brandColor: '#0EA5E9', accent: '#BAE6FD', font: 'inter' },
    sections: [
      sec(idGen, 'hero', true, {
        layout: 'split',
        ctaText: 'Lihat Katalog',
        ctaAction: 'scroll-services',
      }),
      sec(idGen, 'services', true, { layout: 'grid', heading: 'Produk Kami' }),
      sec(idGen, 'cta-banner', true, {
        heading: 'Pesan via WhatsApp',
        subtext: 'Order minimum bisa langsung dari WhatsApp.',
        style: 'minimal',
        ctaText: 'Chat sekarang',
      }),
      sec(idGen, 'branches', true, { heading: 'Lokasi Toko' }),
      sec(idGen, 'hours', true, {}),
      sec(idGen, 'contact', true, {}),
      sec(idGen, 'footer', true, {}),
    ],
    seo: { title: '', description: '', ogImageAssetKey: null },
  }
}

// ─── Service — Salon / Jasa ──────────────────────────────────────────

function salonJasaPreset(idGen: IdGen): SiteSettingsV2 {
  return {
    theme: { brandColor: '#DB2777', accent: '#FBCFE8', font: 'poppins' },
    sections: [
      sec(idGen, 'hero', true, {
        layout: 'color-bg',
        ctaText: 'Booking Sekarang',
        ctaAction: 'whatsapp',
        tagline: 'Layanan profesional dengan harga ramah.',
      }),
      sec(idGen, 'queue', true, {}),
      sec(idGen, 'services', true, { layout: 'list', showDuration: true }),
      sec(idGen, 'cta-banner', true, {
        heading: 'Antri online, hemat waktu',
        subtext: 'Pesan slot via WhatsApp tanpa harus menunggu lama di tempat.',
        ctaText: 'Booking via WA',
      }),
      sec(idGen, 'gallery', true, { heading: 'Hasil Kerja Kami' }),
      sec(idGen, 'hours', true, {}),
      sec(idGen, 'maps', true, {}),
      sec(idGen, 'contact', true, {}),
      sec(idGen, 'footer', true, {}),
    ],
    seo: { title: '', description: '', ogImageAssetKey: null },
  }
}

// ─── Service — Cuci Motor / Walk-in queue ────────────────────────────

function walkInQueuePreset(idGen: IdGen): SiteSettingsV2 {
  return {
    theme: { brandColor: '#0F766E', accent: '#99F6E4', font: 'inter' },
    sections: [
      sec(idGen, 'hero', true, {
        layout: 'color-bg',
        ctaText: 'Lihat Antrian',
        ctaAction: 'scroll-services',
        tagline: 'Datang langsung — cek antrian sekarang.',
      }),
      // Aggregate mode is the right default for walk-in cuci motor /
      // klinik: customers think "how many in line right now?" not
      // "which bay is busiest". Salon/Jasa preset stays per-staff.
      sec(idGen, 'queue', true, { displayMode: 'aggregate' }),
      sec(idGen, 'services', true, { layout: 'grid', heading: 'Layanan & Harga' }),
      sec(idGen, 'maps', true, { heading: 'Lokasi Kami' }),
      sec(idGen, 'hours', true, {}),
      sec(idGen, 'contact', true, {}),
      sec(idGen, 'footer', true, {}),
    ],
    seo: { title: '', description: '', ogImageAssetKey: null },
  }
}

// ─── Public registry ─────────────────────────────────────────────────

export const PRESETS: Record<string, SitePreset> = {
  mini: {
    id: 'mini',
    name: 'Mini / Simple',
    category: 'Universal',
    description: 'Tampilan paling ringkas — judul, daftar harga, jam, kontak.',
    vibe: 'Bersih, fokus',
    build: () => miniPreset(genId),
  },
  'warung-modern': {
    id: 'warung-modern',
    name: 'Warung Modern',
    category: 'F&B',
    description: 'Untuk warung, depot, atau katering. Menu grid + map + cerita usaha.',
    vibe: 'Hangat, ramah',
    build: () => warungModernPreset(genId),
  },
  'kafe-resto': {
    id: 'kafe-resto',
    name: 'Kafe / Resto',
    category: 'F&B',
    description: 'Untuk kafe / restoran. Hero foto besar, galeri suasana, reservasi.',
    vibe: 'Editorial, premium',
    build: () => kafeRestoPreset(genId),
  },
  'toko-retail': {
    id: 'toko-retail',
    name: 'Toko Retail',
    category: 'Retail',
    description: 'Untuk toko retail. Hero split, katalog grid, lokasi cabang.',
    vibe: 'Profesional, terstruktur',
    build: () => tokoRetailPreset(genId),
  },
  'salon-jasa': {
    id: 'salon-jasa',
    name: 'Salon / Jasa',
    category: 'Jasa',
    description: 'Untuk salon, barbershop, klinik. Booking menonjol, galeri hasil.',
    vibe: 'Stylish, percaya diri',
    build: () => salonJasaPreset(genId),
  },
  'walk-in-queue': {
    id: 'walk-in-queue',
    name: 'Cuci Motor / Walk-in',
    category: 'Jasa',
    description: 'Untuk usaha antri walk-in. Antrian live menonjol, peta lokasi.',
    vibe: 'Cepat, transparan',
    build: () => walkInQueuePreset(genId),
  },
}

export const PRESET_ORDER: string[] = [
  'mini',
  'warung-modern',
  'kafe-resto',
  'toko-retail',
  'salon-jasa',
  'walk-in-queue',
]

export function getPreset(id: string) {
  return PRESETS[id] ?? null
}

// ─── ID generation ───────────────────────────────────────────────────

/**
 * Cross-platform UUID generator. crypto.randomUUID() works in both
 * Node 18+ and modern browsers, so we can use the global without an
 * import. Falls back to a non-crypto random for ancient environments
 * (shouldn't happen in our stack but defensive).
 */
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}
