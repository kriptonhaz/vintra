/**
 * JUR-13: Help center article catalog.
 *
 * Articles are stored as TypeScript modules (not DB rows) — they're
 * tenant-agnostic and version with the code, so they always reflect
 * the actual feature surface that just shipped. Each article has a
 * `slug` (URL), `title`, short `summary`, an icon-keyed category, and
 * a JSX `body` rendered inside the help layout.
 *
 * Adding a new article:
 *   1. Append an entry to `HELP_ARTICLES`
 *   2. The route /help auto-lists it; /help/<slug> auto-renders
 *
 * Indonesian copy is the source of truth — the audience is Indonesian business owners
 * owners. Avoid translated marketing speak; write like a friend
 * explaining the feature.
 */
import type { ReactNode } from 'react'
import {
  ShoppingCart,
  Package,
  Sparkles,
  Tag,
  Receipt,
  Building2,
  Printer,
  Calculator,
} from 'lucide-react'

export interface HelpArticle {
  slug: string
  title: string
  summary: string
  /** Lucide icon component used in the index card + article header. */
  icon: typeof ShoppingCart
  /** Reading time in minutes (rough estimate; shown next to title). */
  readMinutes: number
  /** Category label used to group articles on the index page. */
  category: 'mulai' | 'kasir' | 'inventaris' | 'penjualan' | 'lanjutan'
  body: ReactNode
}

export const CATEGORY_LABELS: Record<HelpArticle['category'], string> = {
  mulai: 'Mulai Cepat',
  kasir: 'Kasir',
  inventaris: 'Inventaris & HPP',
  penjualan: 'Penjualan & Promo',
  lanjutan: 'Lanjutan',
}

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'mulai-cepat-transaksi-pertama',
    title: 'Mulai cepat: catat transaksi pertama',
    summary:
      'Dari daftar gratis sampai ngering transaksi pertama dalam 5 menit.',
    icon: ShoppingCart,
    readMinutes: 4,
    category: 'mulai',
    body: (
      <>
        <p>
          Setelah daftar dan onboarding, kamu langsung dapat akses ke modul
          <strong> Kasir</strong> (POS) plus <strong>HPP</strong>. Dua modul
          ini cukup buat mulai jualan.
        </p>
        <h2>Langkah-langkah</h2>
        <ol>
          <li>
            Buka <code>/pos/cashier</code>. Sidebar otomatis collapse biar
            layar penuh dipakai grid produk + cart.
          </li>
          <li>
            Tap produk di grid kiri → masuk cart. Kalau produknya belum ada,
            tap <strong>+ Item Lain</strong> di header cart untuk tambah
            ad-hoc (nama + harga manual, tanpa potong stok).
          </li>
          <li>
            Optional: tap <strong>+ Tambah Pelanggan</strong> di atas cart
            untuk pasang pelanggan ke transaksi (lookup by nomor HP).
          </li>
          <li>
            Tap <strong>Bayar</strong> → pilih metode (Tunai / QRIS / dll
            sesuai paket) → masukkan jumlah dibayar → Selesai.
          </li>
          <li>
            Modal sukses muncul → Cetak struk PDF, Unduh A4, atau bagikan
            ringkasan via WhatsApp.
          </li>
        </ol>
        <p>
          Itu transaksi pertama. Stok produk otomatis berkurang (kalau
          item-nya terhubung ke inventaris), dan sale tercatat di
          <strong> Riwayat Transaksi</strong>.
        </p>
      </>
    ),
  },
  {
    slug: 'setup-inventaris-item-unit-harga-grosir',
    title: 'Setup inventaris: item, unit, harga grosir',
    summary:
      'Atur stok item kamu plus harga grosir per kuantitas (tier pricing).',
    icon: Package,
    readMinutes: 6,
    category: 'inventaris',
    body: (
      <>
        <p>
          Modul Inventaris (paket Toko ke atas) ngatur stok item per cabang.
          Tambah item dari <code>/inventory/items</code>:
        </p>
        <ol>
          <li>
            Tap <strong>+ Tambah Item</strong>
          </li>
          <li>
            Isi nama, kategori (opsional), unit dasar (gram, ml, pcs, dst),
            harga modal (cost price)
          </li>
          <li>
            Set stok awal per cabang dari <strong>Stok Masuk</strong> di
            halaman detail item
          </li>
        </ol>
        <h2>Multi-unit + harga grosir</h2>
        <p>
          Kalau satu item bisa dijual dalam beberapa unit (cth. gula dijual
          per gram, per kg, atau per karung), tambah unit alternatif di
          halaman detail. Untuk tiap unit, kamu bisa set tier harga:
        </p>
        <ul>
          <li>1 kg = Rp 15.000 (harga eceran)</li>
          <li>5 kg = Rp 14.000/kg (harga grosir kecil)</li>
          <li>25 kg = Rp 13.000/kg (harga grosir besar)</li>
        </ul>
        <p>
          Cashier otomatis pakai tier yang sesuai berdasarkan kuantitas
          yang ditap. Kalau rangkainnya bukan kelipatan tier, sistem ambil
          tier dengan minQty terbesar yang masih ≤ kuantitas dijual.
        </p>
      </>
    ),
  },
  {
    slug: 'resep-produk-auto-deduct-bahan',
    title: 'Resep produk: auto-deduct bahan saat penjualan',
    summary:
      'Hubungkan resep HPP ke item inventaris biar stok bahan otomatis berkurang tiap jualan.',
    icon: Calculator,
    readMinutes: 7,
    category: 'inventaris',
    body: (
      <>
        <p>
          Buat <strong>kafe / warung kopi / F&B</strong>: tiap kali kamu jual
          1 cup Es Teh, sistem otomatis kurangi 200 ml teh seduh, 50 ml susu,
          dan 1 pcs es batu dari stok bahan.
        </p>
        <h2>Setup</h2>
        <ol>
          <li>
            Di <strong>HPP</strong>, buat produk "Es Teh" + isi resepnya
            (step 2 di kalkulator HPP)
          </li>
          <li>
            Di <strong>Inventaris</strong>, untuk tiap bahan (teh, susu,
            es batu): tambah inventory item dan set
            <strong> "Terhubung ke bahan HPP"</strong> ke material yang
            sesuai
          </li>
          <li>
            Di <strong>Inventaris</strong>, untuk produk "Es Teh": set
            <strong> "Terhubung ke produk HPP"</strong> ke produk Es Teh
          </li>
        </ol>
        <p>
          Setelah ini, tiap kali Es Teh terjual di kasir, lihat halaman
          detail item Es Teh → muncul panel "Stok-out otomatis: 200 ml teh
          seduh, 50 ml susu, 1 pcs es batu". Stok bahan otomatis berkurang.
        </p>
        <h2>Bahan belum terhubung ke inventaris?</h2>
        <p>
          Sistem skip silently dan kirim notifikasi sekali per bahan. Buka
          notifikasi → langsung ke halaman Inventaris dengan filter
          "Terhubung ke bahan ini" untuk fix.
        </p>
        <p>
          <em>
            Catatan: tier paket Toko ke atas. Free tier bisa setup resep di
            HPP tapi auto-deduct nggak aktif.
          </em>
        </p>
      </>
    ),
  },
  {
    slug: 'konfigurasi-loyalty-poin',
    title: 'Konfigurasi loyalty poin (Komplit)',
    summary:
      'Pelanggan dapat poin dari belanja, bisa ditukar diskon di transaksi berikutnya.',
    icon: Sparkles,
    readMinutes: 5,
    category: 'penjualan',
    body: (
      <>
        <p>
          Loyalty poin tersedia di paket <strong>Komplit</strong>. Aktifkan
          dari <code>/pos/settings</code>:
        </p>
        <ol>
          <li>Toggle "Aktifkan loyalty poin"</li>
          <li>
            Set <strong>Earn rate</strong>: berapa poin per Rp belanja.
            Default 0,001 = 1 poin per Rp 1.000.
          </li>
          <li>
            Set <strong>Redeem rate</strong>: berapa Rp per poin saat ditukar.
            Default 10 = 1 poin = Rp 10.
          </li>
        </ol>
        <p>
          Dengan default tersebut, belanja Rp 100.000 dapat 100 poin senilai
          Rp 1.000 di transaksi berikutnya. Margin loyalty kamu 1% dari
          revenue.
        </p>
        <h2>Cara pakai di kasir</h2>
        <p>
          Pasang pelanggan ke transaksi (via picker di cart). Kalau loyalty
          aktif + pelanggan punya saldo, muncul panel "Saldo poin" di bawah
          customer chip. Cashier bisa input poin yang mau ditukar atau tap
          "Tukar maks". Nilai diskon otomatis terhitung.
        </p>
        <h2>Detail pelanggan</h2>
        <p>
          Buka <code>/master/customers/&lt;id&gt;</code> → tab "Loyalty Poin"
          untuk lihat saldo + lifetime earned/redeemed + ledger 50 movement
          terakhir.
        </p>
      </>
    ),
  },
  {
    slug: 'bikin-kode-promo',
    title: 'Bikin kode promo + auto-promo (Komplit)',
    summary:
      'Tiga jenis promo: kode yang diketik customer, auto-apply per produk, auto-apply ke seluruh cart.',
    icon: Tag,
    readMinutes: 6,
    category: 'penjualan',
    body: (
      <>
        <p>
          Paket Komplit dapat tiga tipe promo dalam satu konfigurasi.
          Akses dari <code>/pos/promos</code>:
        </p>
        <h2>1. Kode promo</h2>
        <p>
          Customer ketik kode (cth. <code>HEMAT20</code>) di kasir → server
          validasi → diskon ke total cart. Bisa di-cap total redemption +
          per-customer + minimal cart total + window tanggal.
        </p>
        <h2>2. Auto-apply per produk</h2>
        <p>
          Pilih satu produk + diskon. Tiap kali produk masuk cart, diskon
          otomatis terapply tanpa cashier ngapain. Cocok buat "Es Teh -20%
          minggu ini".
        </p>
        <h2>3. Auto-apply cart-wide</h2>
        <p>
          Diskon ke total cart, otomatis terapply selama window aktif.
          Cocok buat "happy hour 5–7 sore -10%".
        </p>
        <h2>Stacking</h2>
        <p>
          Urutan diskon: <code>line_discount + auto_product → cart subtotal
          → sale_discount + code/auto_cart → loyalty redeem → tax → total</code>.
          Kode dan auto_cart eksklusif (kode menang); auto_product dan
          line_discount stack berurutan.
        </p>
      </>
    ),
  },
  {
    slug: 'multi-outlet-tambah-cabang',
    title: 'Multi-outlet: tambah cabang baru',
    summary:
      'Tiap modul dibilling per outlet. Aktifkan modul di outlet baru tanpa migrasi data.',
    icon: Building2,
    readMinutes: 4,
    category: 'lanjutan',
    body: (
      <>
        <p>
          Tiap modul (POS, Inventaris, Absensi) dibilling <strong>per outlet</strong>.
          Cabang pertama otomatis aktif saat tenant register.
        </p>
        <h2>Tambah cabang baru</h2>
        <ol>
          <li>
            Buka <code>/master/branches</code> → tap <strong>+ Cabang Baru</strong>
          </li>
          <li>
            Isi nama + alamat + radius (kalau pakai geofence absensi)
          </li>
          <li>
            Aktifkan modul yang dibutuhkan dari billing tiap modul
            (per-outlet pricing). Stok inventaris jalan independen per
            cabang dari awal.
          </li>
        </ol>
        <h2>Cashier per cabang</h2>
        <p>
          Cashier punya picker cabang di header (Toko ke atas). Sales
          tercatat per cabang; reports bisa difilter per cabang dari
          <code> /pos/reports</code>.
        </p>
      </>
    ),
  },
  {
    slug: 'cetak-struk-printer-thermal',
    title: 'Cetak struk: setup printer thermal',
    summary:
      'Cetak struk via PDF (semua paket) atau langsung ke printer thermal Bluetooth (akan datang).',
    icon: Printer,
    readMinutes: 3,
    category: 'kasir',
    body: (
      <>
        <p>
          Saat ini struk bisa dicetak via PDF download atau preview cetak
          browser. Format thermal 80mm + A4 keduanya tersedia.
        </p>
        <h2>Cara cetak</h2>
        <ol>
          <li>Selesai transaksi → modal sukses muncul</li>
          <li>
            Tap <strong>Cetak</strong> → buka preview cetak browser → pilih
            printer (kalau printer thermal kamu sudah connect ke OS,
            biasanya muncul di list)
          </li>
          <li>
            Atau tap <strong>Unduh PDF</strong> untuk download file struk
            (default thermal 80mm)
          </li>
          <li>
            Atau <strong>Bagikan WA</strong> untuk kirim ringkasan teks
            ke pelanggan via WhatsApp
          </li>
        </ol>
        <h2>Logo + footer custom (Toko ke atas)</h2>
        <p>
          Upload logo toko di <code>/pos/settings</code> → muncul di atas
          struk. Footer kustom (cth. "Toko Maju Jaya • Jl. Sudirman 1")
          juga bisa diatur di sana.
        </p>
        <h2>Web Bluetooth direct print</h2>
        <p>
          <em>
            Coming soon — driver thermal printer langsung tanpa harus print-
            preview lewat OS. Saat ini print via OS sudah cukup buat semua
            printer 80mm yang umum di pasar.
          </em>
        </p>
      </>
    ),
  },
  {
    slug: 'pajak-diskon-cara-kerjanya',
    title: 'Pajak + diskon: cara kerjanya',
    summary:
      'Urutan kalkulasi total + cara stack line discount, sale discount, promo, loyalty, dan pajak.',
    icon: Receipt,
    readMinutes: 5,
    category: 'lanjutan',
    body: (
      <>
        <p>
          Sistem kasir punya lima jenis pengurangan/penambahan ke total
          cart. Urutannya tetap dan deterministik:
        </p>
        <ol>
          <li>
            <strong>Subtotal</strong> = Σ (qty × harga satuan) per line
          </li>
          <li>
            <strong>Diskon item (JUR-7)</strong> + <strong>auto-promo per
            produk (JUR-9)</strong> — keduanya per-line, stack berurutan
            di gross line
          </li>
          <li>
            <strong>Cart subtotal</strong> = Σ (line - line_discount -
            auto_product_promo)
          </li>
          <li>
            <strong>Diskon cart</strong> (sale-level manual) — apply ke
            cart subtotal
          </li>
          <li>
            <strong>Promo cart-level</strong> (kode atau auto_cart) — kode
            menang kalau ada, kalau nggak pilih auto_cart dengan amount
            terbesar
          </li>
          <li>
            <strong>Loyalty redeem</strong> — capped ke post-discount,
            post-promo subtotal
          </li>
          <li>
            <strong>Pajak (PPN)</strong> = (subtotal - semua diskon -
            redeem) × tax_percent
          </li>
          <li>
            <strong>Total</strong> = subtotal post-discount + tax
          </li>
        </ol>
        <h2>Loyalty earn</h2>
        <p>
          Poin yang didapat customer dihitung dari <em>post-redemption
          pre-tax</em> base, biar customer nggak earn di poin yang baru aja
          mereka tukar (no double-dip).
        </p>
        <h2>Reports</h2>
        <p>
          Di <code>/pos/reports</code>, ringkasan memisahkan diskon item
          vs diskon cart vs loyalty redeem vs pajak — biar kamu bisa lihat
          margin sesungguhnya per kategori.
        </p>
      </>
    ),
  },
]

export function getArticleBySlug(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug)
}
