/**
 * Transactional email via Brevo's REST API.
 *
 * No SDK — just `fetch`. Brevo's transactional endpoint is:
 *   POST https://api.brevo.com/v3/smtp/email
 *
 * Headers: `api-key: <key>`, `content-type: application/json`
 *
 * Lazy-checked env: when `BREVO_API_KEY` is missing, `sendEmail` becomes
 * a no-op that logs a warning. Same safety pattern as `push.ts` so a
 * misconfigured environment doesn't crash imports.
 *
 * Failures are caught and logged, never thrown. An email glitch must
 * never roll back the financial transaction (or any other parent
 * operation) that triggered it.
 */

import { formatRupiah } from '@/lib/currency'

const SENDER_NAME = 'Vintra'
const SENDER_EMAIL = 'noreply@vintra.my.id'
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

interface SendEmailInput {
  to: string
  toName?: string
  subject: string
  htmlContent: string
  /** Optional plain-text alternative for clients that don't render HTML. */
  textContent?: string
  /** Optional reply-to override. Default: noreply (replies discarded). */
  replyTo?: { email: string; name?: string }
  /** Custom header for tracking the source. Surfaced in Brevo dashboard. */
  tag?: string
}

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey) {
    console.warn('[email] BREVO_API_KEY missing — email delivery disabled')
    return false
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: input.to, name: input.toName }],
        subject: input.subject,
        htmlContent: input.htmlContent,
        textContent: input.textContent,
        replyTo: input.replyTo,
        tags: input.tag ? [input.tag] : undefined,
      }),
    })

    if (!res.ok) {
      // Brevo returns structured error JSON: { code, message }
      let detail = ''
      try {
        const body = await res.json()
        detail = body.message ?? JSON.stringify(body)
      } catch {
        detail = await res.text()
      }
      console.error(
        `[email] Brevo send failed (${res.status}) for ${input.to}:`,
        detail,
      )
      return false
    }

    return true
  } catch (err) {
    console.error('[email] send threw for', input.to, err)
    return false
  }
}

export function formatJakartaDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(date)
}

// ─── Templates ──────────────────────────────────────────────────────

interface PaymentReceiptInput {
  tenantName: string
  invoiceNumber: string
  planLabel: string
  periodStart: Date | string
  periodEnd: Date | string
  billedStaffCount: number
  amountIdr: number
  paidDate: Date | string
  bankReference?: string | null
  /** Absolute URL for the "Lihat Tagihan" CTA. */
  billingUrl: string
}

export function buildPaymentReceiptEmail(input: PaymentReceiptInput): {
  subject: string
  htmlContent: string
  textContent: string
} {
  const subject = `Pembayaran Diterima — ${input.invoiceNumber}`

  const rows: Array<[string, string]> = [
    ['Usaha', input.tenantName],
    ['No. Invoice', input.invoiceNumber],
    ['Modul', 'Absensi'],
    ['Plan', input.planLabel],
    [
      'Periode Aktif',
      `${formatJakartaDate(input.periodStart)} – ${formatJakartaDate(input.periodEnd)}`,
    ],
    ['Jumlah Staf', `${input.billedStaffCount} staf`],
    ['Tanggal Pembayaran', formatJakartaDate(input.paidDate)],
  ]
  if (input.bankReference) {
    rows.push(['Referensi Bank', input.bankReference])
  }

  const tableHtml = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;width:40%;vertical-align:top;">${escape(label)}</td>
        <td style="padding:8px 0;font-size:14px;color:#111827;font-weight:500;">${escape(value)}</td>
      </tr>`,
    )
    .join('')

  const htmlContent = renderShell({
    title: 'Pembayaran diterima',
    intro: `Terima kasih, ${escape(input.tenantName)}! Pembayaran Anda telah kami terima. Detail transaksi:`,
    tableHtml,
    amountLine: `<tr>
      <td style="padding:16px 0 0 0;font-size:14px;color:#6b7280;width:40%;vertical-align:top;border-top:1px solid #e5e7eb;">Total Dibayar</td>
      <td style="padding:16px 0 0 0;font-size:18px;color:#15803d;font-weight:700;border-top:1px solid #e5e7eb;">${escape(formatRupiah(input.amountIdr))}</td>
    </tr>`,
    ctaLabel: 'Lihat Tagihan',
    ctaUrl: input.billingUrl,
    footerNote:
      'Email ini adalah konfirmasi resmi pembayaran Anda. Simpan untuk catatan akuntansi.',
  })

  const textContent = [
    `Pembayaran diterima — ${input.invoiceNumber}`,
    '',
    `Usaha: ${input.tenantName}`,
    `Plan: ${input.planLabel}`,
    `Periode: ${formatJakartaDate(input.periodStart)} – ${formatJakartaDate(input.periodEnd)}`,
    `Total dibayar: ${formatRupiah(input.amountIdr)}`,
    `Tanggal: ${formatJakartaDate(input.paidDate)}`,
    '',
    `Detail tagihan: ${input.billingUrl}`,
  ].join('\n')

  return { subject, htmlContent, textContent }
}

interface RefundReceiptInput {
  tenantName: string
  refundInvoiceNumber: string
  originalInvoiceNumber: string
  refundAmountIdr: number
  refundReason: string
  refundDate: Date | string
  /** True when the admin opted to also deactivate the subscription. */
  endedSubscription: boolean
  billingUrl: string
}

export function buildRefundReceiptEmail(input: RefundReceiptInput): {
  subject: string
  htmlContent: string
  textContent: string
} {
  const subject = `Refund Diproses — ${input.refundInvoiceNumber}`

  const rows: Array<[string, string]> = [
    ['Usaha', input.tenantName],
    ['No. Invoice Refund', input.refundInvoiceNumber],
    ['No. Invoice Asli', input.originalInvoiceNumber],
    ['Tanggal Diproses', formatJakartaDate(input.refundDate)],
    ['Alasan', input.refundReason],
  ]

  const tableHtml = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;width:40%;vertical-align:top;">${escape(label)}</td>
        <td style="padding:8px 0;font-size:14px;color:#111827;font-weight:500;">${escape(value)}</td>
      </tr>`,
    )
    .join('')

  const intro = input.endedSubscription
    ? `Refund untuk invoice <strong>${escape(input.originalInvoiceNumber)}</strong> telah diproses. Akses modul Absensi telah dinonaktifkan.`
    : `Refund untuk invoice <strong>${escape(input.originalInvoiceNumber)}</strong> telah diproses. Detail:`

  const htmlContent = renderShell({
    title: 'Refund diproses',
    intro,
    tableHtml,
    amountLine: `<tr>
      <td style="padding:16px 0 0 0;font-size:14px;color:#6b7280;width:40%;vertical-align:top;border-top:1px solid #e5e7eb;">Jumlah Refund</td>
      <td style="padding:16px 0 0 0;font-size:18px;color:#dc2626;font-weight:700;border-top:1px solid #e5e7eb;">${escape(formatRupiah(input.refundAmountIdr))}</td>
    </tr>`,
    ctaLabel: 'Lihat Riwayat Tagihan',
    ctaUrl: input.billingUrl,
    footerNote:
      'Dana akan dikembalikan ke rekening asal sesuai kebijakan bank Anda (1–7 hari kerja).',
  })

  const textContent = [
    `Refund diproses — ${input.refundInvoiceNumber}`,
    '',
    `Invoice asli: ${input.originalInvoiceNumber}`,
    `Jumlah refund: ${formatRupiah(input.refundAmountIdr)}`,
    `Alasan: ${input.refundReason}`,
    `Tanggal: ${formatJakartaDate(input.refundDate)}`,
    '',
    `Riwayat tagihan: ${input.billingUrl}`,
  ].join('\n')

  return { subject, htmlContent, textContent }
}

interface SignupVerificationInput {
  fullName: string
  /** The Supabase action_link from `auth.admin.generateLink({type:'signup'})`. */
  actionLink: string
}

/**
 * Email-signup verification message. We send this ourselves via Brevo
 * instead of letting Supabase's hosted SMTP do it — that mailer is
 * rate-limited (the project hit "Error sending confirmation email" on
 * normal signups) and we want one consistent sender + template family
 * across every transactional email this app issues.
 */
export function buildSignupVerificationEmail(input: SignupVerificationInput): {
  subject: string
  htmlContent: string
  textContent: string
} {
  const subject = 'Verifikasi akun Vintra Anda'

  const intro = `Halo ${escape(input.fullName)}, terima kasih telah mendaftar di Vintra! Klik tombol di bawah untuk memverifikasi email Anda dan mengaktifkan akun.`

  const htmlContent = renderShell({
    title: 'Verifikasi email Anda',
    intro,
    tableHtml: '',
    amountLine: '',
    ctaLabel: 'Verifikasi Sekarang',
    ctaUrl: input.actionLink,
    footerNote:
      'Link verifikasi ini akan kedaluwarsa dalam 24 jam. Jika Anda tidak mendaftar di Vintra, abaikan email ini.',
  })

  const textContent = [
    `Halo ${input.fullName},`,
    '',
    'Terima kasih telah mendaftar di Vintra!',
    '',
    'Klik link berikut untuk memverifikasi email Anda:',
    input.actionLink,
    '',
    'Link ini akan kedaluwarsa dalam 24 jam.',
  ].join('\n')

  return { subject, htmlContent, textContent }
}

interface MemberInviteEmailInput {
  /** Invitee display name. */
  fullName: string
  /** Tenant / business name they're being invited into. */
  businessName: string
  /** The Supabase action_link from `auth.admin.generateLink({type:'invite'})`. */
  actionLink: string
}

/**
 * Team-member invite message. Same rationale as the other auth emails:
 * route through Brevo, not Supabase's rate-limited hosted SMTP. The
 * invite action_link is issued by Supabase (carries the one-time token);
 * clicking it lands the invitee on /auth/reset-password to set their
 * password, after which they can log in as a member of the tenant.
 */
export function buildMemberInviteEmail(input: MemberInviteEmailInput): {
  subject: string
  htmlContent: string
  textContent: string
} {
  const subject = `Undangan bergabung ke ${input.businessName} di Vintra`

  const intro = `Halo ${escape(input.fullName)}, Anda diundang untuk bergabung sebagai anggota tim ${escape(input.businessName)} di Vintra. Klik tombol di bawah untuk mengaktifkan akun dan membuat password Anda.`

  const htmlContent = renderShell({
    title: 'Anda diundang ke Vintra',
    intro,
    tableHtml: '',
    amountLine: '',
    ctaLabel: 'Aktifkan Akun',
    ctaUrl: input.actionLink,
    footerNote:
      'Link undangan ini akan kedaluwarsa dalam 24 jam. Jika Anda tidak mengenal undangan ini, abaikan email ini.',
  })

  const textContent = [
    `Halo ${input.fullName},`,
    '',
    `Anda diundang untuk bergabung ke ${input.businessName} di Vintra.`,
    '',
    'Klik link berikut untuk mengaktifkan akun dan membuat password:',
    input.actionLink,
    '',
    'Link ini akan kedaluwarsa dalam 24 jam.',
  ].join('\n')

  return { subject, htmlContent, textContent }
}

interface PasswordResetEmailInput {
  /** The Supabase action_link from `auth.admin.generateLink({type:'recovery'})`. */
  actionLink: string
  /**
   * Mirror of the Supabase OTP expiry config (Authentication → Email
   * Templates → "Reset Password" → Expiry). Surfaced in the copy so the
   * user knows how soon they need to click. Default 24 hours.
   */
  expiresInHours?: number
}

/**
 * Password-reset message. Same rationale as buildSignupVerificationEmail:
 * route through Brevo instead of Supabase's hosted SMTP so we get
 * consistent deliverability and branded copy. The recovery action_link
 * is still issued by Supabase (it carries the one-time token), we're
 * only changing the transport.
 */
export function buildPasswordResetEmail(input: PasswordResetEmailInput): {
  subject: string
  htmlContent: string
  textContent: string
} {
  const hours = input.expiresInHours ?? 24
  const subject = 'Reset password akun Vintra'

  const intro =
    'Kami menerima permintaan untuk mereset password akun Vintra Anda. Klik tombol di bawah untuk membuat password baru.'

  const htmlContent = renderShell({
    title: 'Reset password Anda',
    intro,
    tableHtml: '',
    amountLine: '',
    ctaLabel: 'Reset Password',
    ctaUrl: input.actionLink,
    footerNote: `Link ini akan kedaluwarsa dalam ${hours} jam. Jika Anda tidak meminta reset password, abaikan email ini — akun Anda tetap aman.`,
  })

  const textContent = [
    'Reset password Vintra',
    '',
    'Kami menerima permintaan untuk mereset password akun Anda.',
    '',
    'Klik link berikut untuk membuat password baru:',
    input.actionLink,
    '',
    `Link ini akan kedaluwarsa dalam ${hours} jam.`,
    '',
    'Jika Anda tidak meminta reset password, abaikan email ini.',
  ].join('\n')

  return { subject, htmlContent, textContent }
}

interface FeedbackReplyEmailInput {
  tenantName: string
  subject: string
  replyPreview: string
  feedbackUrl: string
}

export function buildFeedbackReplyEmail(input: FeedbackReplyEmailInput): {
  subject: string
  htmlContent: string
  textContent: string
} {
  const subject = `Balasan feedback: ${input.subject}`
  const safePreview = input.replyPreview.slice(0, 600)
  const htmlContent = renderShell({
    title: 'Feedback Anda sudah dibalas',
    intro: `Halo ${escape(input.tenantName)}, tim Vintra sudah membalas feedback Anda.`,
    tableHtml: `
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;width:40%;vertical-align:top;">Subjek</td>
        <td style="padding:8px 0;font-size:14px;color:#111827;font-weight:500;">${escape(input.subject)}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;font-size:14px;color:#6b7280;width:40%;vertical-align:top;">Preview Balasan</td>
        <td style="padding:8px 0;font-size:14px;color:#111827;font-weight:500;white-space:pre-line;">${escape(safePreview)}</td>
      </tr>`,
    amountLine: '',
    ctaLabel: 'Lihat Feedback',
    ctaUrl: input.feedbackUrl,
    footerNote:
      'Email ini dikirim karena feedback belum dibuka dalam 24 jam sejak dibalas.',
  })

  const textContent = [
    'Feedback Anda sudah dibalas',
    '',
    `Usaha: ${input.tenantName}`,
    `Subjek: ${input.subject}`,
    '',
    safePreview,
    '',
    `Lihat feedback: ${input.feedbackUrl}`,
  ].join('\n')

  return { subject, htmlContent, textContent }
}

interface ContactReplyEmailInput {
  name: string
  originalSubject: string
  originalBody: string
  replyBody: string
  /** Public landing page submitters reach back to us via /contact. */
  contactUrl: string
}

/**
 * JUR-148: Brevo reply to a public /contact submission. This is the
 * primary reply channel for public threads — there's no in-app inbox
 * for anonymous submitters, so an admin reply has to land in their
 * inbox or they never hear back. Subject is prefixed with `Re:` so
 * the user's mail client threads it under the (now-replied) original.
 */
export function buildContactReplyEmail(input: ContactReplyEmailInput): {
  subject: string
  htmlContent: string
  textContent: string
} {
  const subject = `Re: ${input.originalSubject}`
  const safeReply = input.replyBody.slice(0, 8000)
  const safeOriginal = input.originalBody.slice(0, 2000)

  const htmlContent = renderShell({
    title: 'Balasan dari tim Vintra',
    intro: `Halo ${escape(input.name)}, terima kasih sudah menghubungi kami. Berikut balasan tim Vintra untuk pesan Anda:`,
    tableHtml: `
      <tr>
        <td colspan="2" style="padding:8px 0 16px 0;font-size:15px;line-height:1.6;color:#111827;white-space:pre-line;">${escape(safeReply)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:16px 0 8px 0;font-size:12px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.04em;border-top:1px solid #e5e7eb;">Pesan asli Anda</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#6b7280;width:30%;vertical-align:top;">Subjek</td>
        <td style="padding:4px 0;font-size:13px;color:#374151;">${escape(input.originalSubject)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:8px 0 0 0;font-size:13px;line-height:1.5;color:#6b7280;white-space:pre-line;">${escape(safeOriginal)}</td>
      </tr>`,
    amountLine: '',
    ctaLabel: 'Kirim Pesan Lanjutan',
    ctaUrl: input.contactUrl,
    footerNote:
      'Balasan email ini tidak terbaca oleh sistem kami. Untuk pertanyaan lanjutan, gunakan tombol di atas atau kunjungi vintra.my.id/contact.',
  })

  const textContent = [
    `Halo ${input.name},`,
    '',
    'Terima kasih sudah menghubungi tim Vintra. Berikut balasan kami:',
    '',
    safeReply,
    '',
    '— Pesan asli —',
    `Subjek: ${input.originalSubject}`,
    '',
    safeOriginal,
    '',
    `Untuk pertanyaan lanjutan: ${input.contactUrl}`,
  ].join('\n')

  return { subject, htmlContent, textContent }
}

// ─── Shared HTML shell ──────────────────────────────────────────────

interface ShellInput {
  title: string
  intro: string
  tableHtml: string
  amountLine: string
  ctaLabel: string
  ctaUrl: string
  footerNote: string
}

/**
 * Single visual template used by every transactional email. Mirrors
 * the Supabase auth templates (same green brand color, same wordmark
 * header, same card-on-gray layout) so the user inbox feels coherent
 * across signup, reset password, and these receipts.
 */
function renderShell(s: ShellInput): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(s.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f9fafb;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <tr>
            <td style="padding:32px 32px 0 32px;text-align:left;">
              <p style="margin:0;font-size:18px;font-weight:700;color:#15803d;letter-spacing:-0.01em;">Vintra</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 8px 32px;">
              <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${escape(s.title)}</h1>
              <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#374151;">${s.intro}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                ${s.tableHtml}
                ${s.amountLine}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px 32px;text-align:center;">
              <a href="${s.ctaUrl}" style="display:inline-block;background-color:#15803d;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 28px;border-radius:8px;">${escape(s.ctaLabel)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 32px 32px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#9ca3af;">${escape(s.footerNote)}</p>
              <p style="margin:12px 0 0 0;font-size:12px;line-height:1.5;color:#9ca3af;">© Vintra · Platform bisnis Indonesia</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * Minimal HTML escape for safely interpolating user-controlled strings
 * (tenant names, refund reasons, invoice numbers) into our templates.
 * Brevo accepts arbitrary HTML so the responsibility is ours.
 */
function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
