import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Compact HMAC-signed QR token.
 *
 * The QR data encodes a payload + signature:
 *   `${base64url(payload)}.${base64url(sig)}`
 *
 * Signatures bind the token to a specific tenant + branch + host and a short
 * expiry. Server-side verification is stateless EXCEPT for the one-shot nonce
 * check (see `qr_consumed_nonces`) which prevents replay.
 */

interface QrPayload {
  /** Tenant id */
  t: string
  /** Branch id */
  b: string
  /** Host user id (owner/admin displaying the QR) */
  h: string
  /** One-shot nonce */
  n: string
  /** Issued-at (ms since epoch) */
  iat: number
  /** Expires-at (ms since epoch) */
  exp: number
}

function getSecret(): Buffer {
  const secret = process.env.ATTENDANCE_QR_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'ATTENDANCE_QR_SECRET env var is required (>=32 bytes hex or random).',
    )
  }
  return Buffer.from(secret, 'utf8')
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return Buffer.from(b64, 'base64')
}

function sign(payloadB64: string): string {
  const h = createHmac('sha256', getSecret())
  h.update(payloadB64)
  return b64urlEncode(h.digest())
}

export interface GenerateQrTokenParams {
  tenantId: string
  branchId: string
  hostUserId: string
  ttlSeconds: number
}

export interface GenerateQrTokenResult {
  token: string
  nonce: string
  expiresAt: Date
}

export function generateQrToken(
  params: GenerateQrTokenParams,
): GenerateQrTokenResult {
  const now = Date.now()
  const expMs = now + params.ttlSeconds * 1000
  const nonce = randomBytes(12).toString('hex')
  const payload: QrPayload = {
    t: params.tenantId,
    b: params.branchId,
    h: params.hostUserId,
    n: nonce,
    iat: now,
    exp: expMs,
  }
  const payloadB64 = b64urlEncode(JSON.stringify(payload))
  const sig = sign(payloadB64)
  return {
    token: `${payloadB64}.${sig}`,
    nonce,
    expiresAt: new Date(expMs),
  }
}

export type VerifyQrTokenFailure =
  | 'malformed'
  | 'bad_signature'
  | 'expired'

export interface VerifyQrTokenResult {
  ok: true
  payload: QrPayload
}

export interface VerifyQrTokenError {
  ok: false
  reason: VerifyQrTokenFailure
}

export function verifyQrToken(
  token: string,
): VerifyQrTokenResult | VerifyQrTokenError {
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'malformed' }
  const [payloadB64, sigB64] = parts

  // Constant-time signature comparison
  const expectedSig = sign(payloadB64!)
  const a = Buffer.from(sigB64!, 'utf8')
  const b = Buffer.from(expectedSig, 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }

  let payload: QrPayload
  try {
    payload = JSON.parse(b64urlDecode(payloadB64!).toString('utf8')) as QrPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (Date.now() > payload.exp) return { ok: false, reason: 'expired' }
  return { ok: true, payload }
}
