import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'

/** Max attendance photo size — 500 KB after client-side compression. */
export const MAX_PHOTO_BYTES = 500 * 1024

let client: S3Client | null = null

function getClient(): S3Client {
  if (client) return client
  const region = process.env.AWS_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY env vars are required for photo upload.',
    )
  }
  client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } })
  return client
}

function getBucket(): string {
  const bucket = process.env.AWS_S3_BUCKET
  if (!bucket) throw new Error('AWS_S3_BUCKET env var is required.')
  return bucket
}

export interface UploadPhotoParams {
  tenantId: string
  staffProfileId: string
  /** YYYY-MM-DD Jakarta date */
  date: string
  /** 'in' for clock-in selfie, 'out' for clock-out */
  slot: 'in' | 'out'
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads an attendance selfie. Object key layout groups by tenant → staff so
 * IAM policies (and later lifecycle rules) can scope easily.
 */
export async function uploadAttendancePhoto(
  params: UploadPhotoParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(`Ukuran foto melebihi batas (${MAX_PHOTO_BYTES / 1024} KB).`)
  }

  const ext = params.mimeType === 'image/png' ? 'png' : 'jpg'
  const key = `${params.tenantId}/${params.staffProfileId}/${params.date}_${params.slot}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      // Object tag drives the S3 lifecycle rule that purges attendance
      // photos after 60 days. Finance proofs are tagged differently so
      // they're never matched by the same rule. NEVER change this value
      // without also updating the lifecycle rule in the AWS console.
      Tagging: 'kind=attendance',
    }),
  )

  return { key }
}

/**
 * Returns a short-lived signed GET URL for displaying a photo in reports.
 * Default TTL is 5 minutes — enough to render a page, short enough that the
 * URL isn't useful if leaked.
 */
export async function getAttendancePhotoSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

/**
 * Best-effort parser: given a data URL (`data:image/jpeg;base64,...`) returns
 * `{ bytes, mimeType }`. Throws if the input doesn't look like a data URL.
 */
export function parseDataUrl(dataUrl: string): { bytes: Buffer; mimeType: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new Error('Format foto tidak valid (harus data URL).')
  const mimeType = match[1] ?? 'image/jpeg'
  const bytes = Buffer.from(match[2] ?? '', 'base64')
  return { bytes, mimeType }
}

export interface AttendanceObject {
  key: string
  size: number
  lastModified: Date | null
}

/**
 * Lists attendance photos, optionally scoped by key prefix.
 * S3 returns up to 1000 keys per call; `maxKeys` caps the slice returned to
 * callers. For larger accounts we'd add pagination via ContinuationToken.
 */
export async function listAttendanceObjects(params?: {
  prefix?: string
  maxKeys?: number
}): Promise<{
  objects: AttendanceObject[]
  totalCount: number
  totalBytes: number
  truncated: boolean
}> {
  const client = getClient()
  const bucket = getBucket()
  const maxKeys = Math.max(1, Math.min(1000, params?.maxKeys ?? 1000))

  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: params?.prefix,
      MaxKeys: maxKeys,
    }),
  )

  const contents = result.Contents ?? []
  const objects: AttendanceObject[] = contents
    .filter((o) => o.Key)
    .map((o) => ({
      key: o.Key!,
      size: o.Size ?? 0,
      lastModified: o.LastModified ?? null,
    }))
    // Newest first
    .sort((a, b) => {
      const at = a.lastModified?.getTime() ?? 0
      const bt = b.lastModified?.getTime() ?? 0
      return bt - at
    })

  const totalCount = result.KeyCount ?? objects.length
  const totalBytes = objects.reduce((sum, o) => sum + o.size, 0)

  return {
    objects,
    totalCount,
    totalBytes,
    truncated: result.IsTruncated ?? false,
  }
}

export async function deleteAttendancePhoto(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── Financial proof uploads ────────────────────────────────────────
// Reuses the same attendance bucket + IAM creds, just a different
// prefix so lifecycle policies can treat the two classes separately
// later (e.g., keep invoices longer than selfies).

/** Max financial proof size — 1 MB (receipts may be larger than selfies). */
export const MAX_FINANCIAL_PROOF_BYTES = 1 * 1024 * 1024

export interface UploadFinancialProofParams {
  tenantId: string
  /** Used in the key so admins can locate the object by invoice later. */
  invoiceNumber: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads a manual-payment proof screenshot. Key layout:
 *   `{tenantId}/finance/{invoiceNumber}.{ext}`
 * Tenant-scoped prefix mirrors attendance photos — same IAM policy
 * covers both.
 */
export async function uploadFinancialProof(
  params: UploadFinancialProofParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_FINANCIAL_PROOF_BYTES) {
    throw new Error(
      `Ukuran bukti transfer melebihi batas (${MAX_FINANCIAL_PROOF_BYTES / 1024} KB).`,
    )
  }
  // Accept common image types; fall back to jpg so the URL always has
  // a sensible extension for browsers.
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/finance/${params.invoiceNumber}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      // Distinct tag from attendance photos so the 60-day lifecycle
      // rule never matches a financial proof. Finance proofs are
      // accounting evidence and must persist long-term.
      Tagging: 'kind=financial-proof',
    }),
  )

  return { key }
}

/**
 * Short-lived signed GET URL for displaying a finance proof in the
 * detail drawer. 5-minute TTL matches attendance photos.
 */
export async function getFinancialProofSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

// ─── Inventory item photo uploads ───────────────────────────────────
// Same bucket + IAM creds as attendance, distinct prefix and tag.
// Lifecycle: kept indefinitely while item is active. Deletion is
// triggered explicitly by the inventory hard-delete path; deactivate
// keeps the photo so re-activation restores the visual.

/** Max inventory photo size — 500 KB after client-side compression. */
export const MAX_INVENTORY_PHOTO_BYTES = 500 * 1024

export interface UploadInventoryPhotoParams {
  tenantId: string
  itemId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads an inventory item photo. Key layout:
 *   `{tenantId}/inventory/{itemId}.{ext}`
 * Single photo per item — re-uploading overwrites the previous file
 * (S3 PUT semantics) so we don't accumulate orphans.
 */
export async function uploadInventoryItemPhoto(
  params: UploadInventoryPhotoParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_INVENTORY_PHOTO_BYTES) {
    throw new Error(
      `Ukuran foto melebihi batas (${MAX_INVENTORY_PHOTO_BYTES / 1024} KB).`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/inventory/${params.itemId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      // Distinct tag so the 60-day attendance lifecycle rule never
      // matches inventory photos. Inventory photos are catalog
      // metadata — they live as long as the item does.
      Tagging: 'kind=inventory-item',
    }),
  )

  return { key }
}

/** Short-lived signed GET URL for displaying an inventory photo. */
export async function getInventoryPhotoSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteInventoryPhoto(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

export interface UploadInventoryGalleryPhotoParams {
  tenantId: string
  itemId: string
  /** Unique id (the gallery row id) so each image gets its own object. */
  photoId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads an extra storefront gallery photo for an item. Key layout:
 *   `{tenantId}/inventory/{itemId}/gallery/{photoId}.{ext}`
 * Unlike the cover photo (one per item, overwritten in place), gallery
 * images are keyed by a unique photoId so an item can hold several.
 * Same 500 KB cap and `kind=inventory-item` lifecycle tag as the cover.
 */
export async function uploadInventoryGalleryPhoto(
  params: UploadInventoryGalleryPhotoParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_INVENTORY_PHOTO_BYTES) {
    throw new Error(
      `Ukuran foto melebihi batas (${MAX_INVENTORY_PHOTO_BYTES / 1024} KB).`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/inventory/${params.itemId}/gallery/${params.photoId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=inventory-item',
    }),
  )

  return { key }
}

// ─── HPP product photos ─────────────────────────────────────────────

export const MAX_HPP_PRODUCT_PHOTO_BYTES = 500 * 1024

export interface UploadHppProductPhotoParams {
  tenantId: string
  productId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads an HPP product photo. Key layout:
 *   `{tenantId}/hpp/{productId}.{ext}`
 * Single photo per product — re-uploading overwrites the previous
 * file (S3 PUT semantics) so we don't accumulate orphans.
 */
export async function uploadHppProductPhoto(
  params: UploadHppProductPhotoParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_HPP_PRODUCT_PHOTO_BYTES) {
    throw new Error(
      `Ukuran foto melebihi batas (${MAX_HPP_PRODUCT_PHOTO_BYTES / 1024} KB).`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/hpp/${params.productId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=hpp-product',
    }),
  )

  return { key }
}

export async function getHppProductPhotoSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteHppProductPhoto(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── Tenant member (Anggota Tim) photos ──────────────────────────────

export const MAX_MEMBER_PHOTO_BYTES = 500 * 1024

export interface UploadMemberPhotoParams {
  tenantId: string
  memberId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads a tenant member's profile photo. Key layout:
 *   `{tenantId}/members/{memberId}.{ext}`
 * Single photo per member — re-upload overwrites (no orphans).
 */
export async function uploadTenantMemberPhoto(
  params: UploadMemberPhotoParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_MEMBER_PHOTO_BYTES) {
    throw new Error(
      `Ukuran foto melebihi batas (${MAX_MEMBER_PHOTO_BYTES / 1024} KB).`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/members/${params.memberId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=tenant-member',
    }),
  )
  return { key }
}

export async function getTenantMemberPhotoSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteTenantMemberPhoto(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── POS receipt logo + receipt PDFs ─────────────────────────────────

/** Max receipt logo size — 200 KB (no transparency considered). */
export const MAX_POS_LOGO_BYTES = 200 * 1024

export interface UploadPOSLogoParams {
  tenantId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads a tenant's POS receipt logo. Single logo per tenant — re-upload
 * overwrites. Stored permanently (no lifecycle rule); tagged distinctly
 * from attendance/inventory so policies stay scoped.
 */
export async function uploadPOSReceiptLogo(
  params: UploadPOSLogoParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_POS_LOGO_BYTES) {
    throw new Error(
      `Ukuran logo melebihi batas (${MAX_POS_LOGO_BYTES / 1024} KB).`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/pos/logo.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=pos-receipt-logo',
    }),
  )

  return { key }
}

export async function getPOSLogoSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deletePOSLogo(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── POS promo flyer ─────────────────────────────────────────────────
// Optional banner uploaded with each promo on /pos/promos. Surfaced
// in the admin list (signed URL) and to the WhatsApp AI's promo RAG
// (Go api fetches via S3 SDK and sends as outbound media when the AI
// references the matching promo). Tag `kind=promo` keeps it OUT of
// the wa-media 24h lifecycle — promos can run for weeks.

/** Max promo image size — 2 MB. Tighter than wa-media because promo
 * banners are flyers/screenshots, not high-res photos. */
export const MAX_PROMO_IMAGE_BYTES = 2 * 1024 * 1024

export interface UploadPromoImageParams {
  tenantId: string
  promoId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads a promo banner. Path is `<tenantId>/promos/<promoId>.<ext>`.
 * Idempotent: re-uploading replaces the existing object at the same
 * key (no orphaned objects). Caller stores `{key}` in
 * `tenant_promotions.image_key`.
 */
export async function uploadPromoImage(
  params: UploadPromoImageParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_PROMO_IMAGE_BYTES) {
    throw new Error(
      `Ukuran gambar promo maksimal ${MAX_PROMO_IMAGE_BYTES / 1024 / 1024} MB.`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/promos/${params.promoId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=promo',
    }),
  )

  return { key }
}

/** Short-lived signed URL for displaying a promo image in the admin
 * /pos/promos page. 5-minute TTL matches the receipt-logo + wa-media
 * pattern. */
export async function getPromoImageSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deletePromoImage(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── Loyalty stamp program image ─────────────────────────────────────
// Optional banner uploaded with each stamp program. Tag `kind=stamp`
// keeps it OUT of the wa-media 24h lifecycle — stamp programs run for
// months. Surfaced in admin, cashier, and the situs Stamp section.

export const MAX_STAMP_IMAGE_BYTES = 2 * 1024 * 1024

export interface UploadStampImageParams {
  tenantId: string
  programId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads a stamp program banner. Path:
 *   `<tenantId>/stamps/<programId>.<ext>`
 * Idempotent — re-uploading replaces the existing object at the same
 * key, so we never accumulate orphans. Caller stores `{key}` in
 * `loyalty_stamp_programs.image_key`.
 */
export async function uploadStampImage(
  params: UploadStampImageParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_STAMP_IMAGE_BYTES) {
    throw new Error(
      `Ukuran gambar stempel maksimal ${MAX_STAMP_IMAGE_BYTES / 1024 / 1024} MB.`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/stamps/${params.programId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=stamp',
    }),
  )

  return { key }
}

/** Short-lived signed URL for admin/cashier (5-min). */
export async function getStampImageSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteStampImage(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── Konten Promosi — AI image generation ────────────────────────────
// Each generation stores up to two objects under `<tenantId>/konten/`:
//   - `<imageId>-src.<ext>` — the product photo the tenant uploaded
//   - `<imageId>.<ext>`     — the AI-enhanced result
// Generous size cap: phone photos run large, and AI results come back
// as high-res PNGs.

export const MAX_KONTEN_IMAGE_BYTES = 10 * 1024 * 1024

export type KontenImageVariant = 'source' | 'result' | 'person'

export interface UploadKontenImageParams {
  tenantId: string
  imageId: string
  variant: KontenImageVariant
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads a Konten source photo or generated result. Idempotent — the
 * key is derived from `imageId` + `variant`, so re-uploading replaces
 * the object in place. Caller stores `{key}` in
 * `konten_images.source_image_key` / `.result_image_key`.
 */
export async function uploadKontenImage(
  params: UploadKontenImageParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_KONTEN_IMAGE_BYTES) {
    throw new Error(
      `Ukuran gambar maksimal ${MAX_KONTEN_IMAGE_BYTES / 1024 / 1024} MB.`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const suffix =
    params.variant === 'source'
      ? '-src'
      : params.variant === 'person'
        ? '-person'
        : ''
  const key = `${params.tenantId}/konten/${params.imageId}${suffix}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=konten',
    }),
  )

  return { key }
}

/** Short-lived signed URL for displaying a Konten image. 5-minute TTL
 * matches the promo/receipt-logo pattern. */
export async function getKontenImageSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

/**
 * Signed URL with Content-Disposition: attachment baked in, so a navigation
 * to it triggers a download instead of inline display. Use this for the
 * "Unduh" action — works on iOS Safari, Brave, and platforms where the
 * `<a download>` attribute is ignored on cross-origin URLs.
 */
export async function getKontenImageDownloadSignedUrl(
  key: string,
  filename: string,
  expiresInSeconds = 300,
): Promise<string> {
  // Strip characters that would corrupt the Content-Disposition header.
  const safeName = filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'konten.png'
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
  })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteKontenImage(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── Logo AI — text-to-image generated logos ─────────────────────────
// One PNG per generation under `<tenantId>/logos/<logoId>.<ext>`.

export const MAX_LOGO_IMAGE_BYTES = 10 * 1024 * 1024

export interface UploadLogoImageParams {
  tenantId: string
  logoId: string
  bytes: Buffer
  mimeType: string
}

/** Uploads a generated logo. Idempotent — the key derives from `logoId`. */
export async function uploadLogoImage(
  params: UploadLogoImageParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_LOGO_IMAGE_BYTES) {
    throw new Error(
      `Ukuran gambar maksimal ${MAX_LOGO_IMAGE_BYTES / 1024 / 1024} MB.`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  const key = `${params.tenantId}/logos/${params.logoId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=logo',
    }),
  )

  return { key }
}

export async function getLogoImageSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

/** Download-disposition signed URL — forces a save instead of inline display. */
export async function getLogoImageDownloadSignedUrl(
  key: string,
  filename: string,
  expiresInSeconds = 300,
): Promise<string> {
  const safeName =
    filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'logo.png'
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
  })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteLogoImage(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── Spanduk (banner) media ──────────────────────────────────────────
// Each spanduk has up to three S3 objects:
//   - bg   : raw AI background pre-composite (kept for re-render)
//   - png  : final composited PNG (background + text overlay strip)
//   - pdf  : print-ready PDF embedding the PNG at physical W×H
// All tagged kind=spanduk so a future lifecycle rule can scope them.

export const MAX_SPANDUK_IMAGE_BYTES = 30 * 1024 * 1024
export const MAX_SPANDUK_PDF_BYTES = 50 * 1024 * 1024

export type SpandukVariant = 'bg' | 'png' | 'pdf' | 'source'

export interface UploadSpandukAssetParams {
  tenantId: string
  spandukId: string
  variant: SpandukVariant
  bytes: Buffer
  mimeType: string
  /** Required for `variant: 'source'` — disambiguates multiple uploads. */
  variantIndex?: number
}

function spandukExt(variant: SpandukVariant, mimeType: string): string {
  if (variant === 'pdf') return 'pdf'
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('webp')) return 'webp'
  return 'jpg'
}

export async function uploadSpandukAsset(
  params: UploadSpandukAssetParams,
): Promise<{ key: string }> {
  const maxBytes =
    params.variant === 'pdf' ? MAX_SPANDUK_PDF_BYTES : MAX_SPANDUK_IMAGE_BYTES
  if (params.bytes.byteLength > maxBytes) {
    throw new Error(
      `Ukuran file melebihi batas (${maxBytes / 1024 / 1024} MB).`,
    )
  }
  const ext = spandukExt(params.variant, params.mimeType)
  const variantSegment =
    params.variant === 'source'
      ? `source-${params.variantIndex ?? 0}`
      : params.variant
  const key = `${params.tenantId}/spanduks/${params.spandukId}.${variantSegment}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=spanduk',
    }),
  )
  return { key }
}

export async function getSpandukSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

/** Download-disposition signed URL — forces a save instead of inline display. */
export async function getSpandukDownloadSignedUrl(
  key: string,
  filename: string,
  expiresInSeconds = 300,
): Promise<string> {
  const safeName =
    filename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'spanduk'
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
  })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteSpandukAsset(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

// ─── WhatsApp media (JUR-75/76) ──────────────────────────────────────
// Inbound media (image / sticker / document) is uploaded by the Go API
// worker — the web app only reads via signed URLs. Outbound media
// (operator picks a file in the composer — JUR-76) uploads through
// `uploadWaMediaOutbound` below before the API enqueues the send.

/**
 * Short-lived signed GET URL for displaying WhatsApp media in the
 * chat detail view. 5-minute TTL matches attendance/inventory pattern;
 * the React Query cache uses 4 minutes so a re-render doesn't refetch
 * an almost-expired URL.
 */
export async function getWaMediaSignedUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

/** Max outbound WhatsApp image size — 5 MB. WhatsApp's hard limit is
 * 16 MB but we cap lower to keep S3 + bandwidth cost bounded and to
 * push operators toward sensible photo sizes. */
export const MAX_WA_MEDIA_BYTES = 5 * 1024 * 1024

export interface UploadWaMediaParams {
  tenantId: string
  instanceId: string
  /** Caller-generated ID, used in the key so the API can validate
   * tenant scope by prefix matching before enqueueing the send. */
  outboundId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads operator-attached outbound WhatsApp media. Tag matches the
 * inbound path so the same 3-day lifecycle (kind=wa-media) catches
 * outbound too — once the send completes, S3 will eventually delete
 * the bytes. The wa_messages row keeps a record of "we sent an image
 * here" even after the bytes are gone.
 */
export async function uploadWaMediaOutbound(
  params: UploadWaMediaParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_WA_MEDIA_BYTES) {
    throw new Error(
      `Ukuran gambar maksimal ${MAX_WA_MEDIA_BYTES / 1024 / 1024} MB. Coba kompres dulu.`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  // Path mirrors inbound (`{tenantId}/wa/{instanceId}/{id}.{ext}`) so
  // a single S3 IAM policy covers both directions.
  const key = `${params.tenantId}/wa/${params.instanceId}/out_${params.outboundId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      CacheControl: 'private, max-age=31536000',
      Tagging: 'kind=wa-media',
    }),
  )

  return { key }
}

// `uploadPOSReceiptPDF` was removed: receipts aren't persisted to S3.
// The cashier renders + downloads/prints PDFs directly from the
// server-returned data URL; nothing is stored. WhatsApp share now
// sends a text-only summary instead of a PDF link.

// ─── Tenant public site assets ───────────────────────────────────────
// JUR-176 follow-up. Tenants upload logos, hero photos, gallery images,
// and OG share images for their public landing page at
// `<slug>.vintra.my.id`. Same lifecycle pattern as inventory/member
// photos: client-side compresses, server stores raw bytes, signed-URL
// GETs for display.

/** Max site asset size — 500 KB after compression. Same as inventory. */
export const MAX_SITE_ASSET_BYTES = 500 * 1024

/**
 * Site asset categories. Pinned to a small enum because the editor
 * declares image fields by kind (logo / hero / gallery / og) and the
 * key layout reads better when the kind is visible in the path.
 */
export type TenantSiteAssetKind = 'logo' | 'hero' | 'gallery' | 'og'

export interface UploadTenantSiteAssetParams {
  tenantId: string
  /** Which category — drives the key prefix + later cleanup queries. */
  kind: TenantSiteAssetKind
  /**
   * Per-asset stable identifier. For single-slot kinds (logo, og)
   * this is just the kind name; for multi-slot kinds (gallery) it
   * should be a uuid or short hash from the caller. Logo/hero/og
   * upload overwrites the same key; gallery uploads collect.
   */
  assetId: string
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads a tenant-site asset. Key layout:
 *   `{tenantId}/site/{kind}/{assetId}.{ext}`
 * Tagged `kind=tenant-site` so future lifecycle / bucket policies can
 * scope to just these objects without scanning the entire prefix tree.
 */
export async function uploadTenantSiteAsset(
  params: UploadTenantSiteAssetParams,
): Promise<{ key: string }> {
  if (params.bytes.byteLength > MAX_SITE_ASSET_BYTES) {
    throw new Error(
      `Ukuran gambar melebihi batas (${MAX_SITE_ASSET_BYTES / 1024} KB).`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : 'jpg'
  // Sanitize assetId — strip anything that isn't safe in an S3 key
  // component. The caller is trusted (auth'd server fn), but the
  // value sometimes comes from user input (uploaded filename) so we
  // belt-and-suspenders it.
  const safeAssetId = params.assetId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'asset'
  const key = `${params.tenantId}/site/${params.kind}/${safeAssetId}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
      // Long max-age — keys include a unique assetId so a new
      // upload doesn't collide; logo/hero/og overwrite the same key
      // so we accept a brief CDN/browser cache lag (acceptable for
      // a marketing surface).
      CacheControl: 'public, max-age=31536000',
      Tagging: 'kind=tenant-site',
    }),
  )
  return { key }
}

/**
 * Signed-URL helper for the public renderer. We pre-sign all asset
 * URLs server-side and embed them in the SSR response so the browser
 * never needs an additional roundtrip.
 *
 * Longer default expiry (1h) than other modules — pages are cached at
 * the edge for a few minutes and we don't want a re-render mid-cache
 * to leave a broken `<img>` tag once the URL ages out.
 */
export async function getTenantSiteAssetSignedUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds })
}

export async function deleteTenantSiteAsset(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

/**
 * Parses a tenant-site asset key into its components.
 * Expected layout: `{tenantId}/site/{kind}/{assetId}.{ext}`
 */
export function parseTenantSiteAssetKey(key: string): {
  tenantId: string
  kind: TenantSiteAssetKind
  assetId: string
} | null {
  const m = key.match(
    /^([0-9a-f-]{36})\/site\/(logo|hero|gallery|og)\/([a-zA-Z0-9_-]+)\.[a-z0-9]+$/i,
  )
  if (!m) return null
  return {
    tenantId: m[1]!,
    kind: m[2] as TenantSiteAssetKind,
    assetId: m[3]!,
  }
}

// ─── Article images (issue #206) ─────────────────────────────────────
// Guide / blog article images — cover photos + inline images inserted
// in the TipTap editor. Unlike every other module these are PUBLIC
// content, so they're served via the `/artikel/media/{mediaId}` proxy
// route (a stable, Cloudflare-cacheable URL) instead of short-lived
// signed URLs — stored article HTML embeds the proxy URL permanently
// and a signed URL would expire out from under it. Key layout:
//   `articles/{uuid}.{ext}`
// Flat, one new uuid per upload, so re-uploads never collide and an
// edited article never breaks an image referenced by an older version.

/** Max article image size — 2 MB. Screenshots / photos for guides. */
export const MAX_ARTICLE_IMAGE_BYTES = 2 * 1024 * 1024

export interface UploadArticleImageParams {
  bytes: Buffer
  mimeType: string
}

/**
 * Uploads an article image. Returns the `mediaId` (`{uuid}.{ext}`); the
 * caller builds the public URL as `/artikel/media/{mediaId}`.
 */
export async function uploadArticleImage(
  params: UploadArticleImageParams,
): Promise<{ mediaId: string }> {
  if (params.bytes.byteLength > MAX_ARTICLE_IMAGE_BYTES) {
    throw new Error(
      `Ukuran gambar maksimal ${MAX_ARTICLE_IMAGE_BYTES / 1024 / 1024} MB.`,
    )
  }
  const ext = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : params.mimeType.includes('gif')
        ? 'gif'
        : 'jpg'
  const mediaId = `${randomUUID()}.${ext}`

  await getClient().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: `articles/${mediaId}`,
      Body: params.bytes,
      ContentType: params.mimeType,
      // Immutable: the uuid filename guarantees content never changes
      // at a given key, so the edge + browser can cache forever.
      CacheControl: 'public, max-age=31536000, immutable',
      Tagging: 'kind=article',
    }),
  )
  return { mediaId }
}

const ARTICLE_IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * Fetches an article image for the `/artikel/media` proxy route.
 * Returns null if the mediaId is malformed or the object is missing.
 */
export async function getArticleImage(
  mediaId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const m = mediaId.match(/^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/i)
  if (!m) return null
  const ext = m[1]!.toLowerCase()
  try {
    const result = await getClient().send(
      new GetObjectCommand({
        Bucket: getBucket(),
        Key: `articles/${mediaId}`,
      }),
    )
    if (!result.Body) return null
    const bytes = await result.Body.transformToByteArray()
    return {
      bytes,
      contentType:
        result.ContentType ??
        ARTICLE_IMAGE_CONTENT_TYPES[ext] ??
        'application/octet-stream',
    }
  } catch {
    return null
  }
}

/**
 * Parses an attendance object key into its components. Expected layout:
 *   `{tenantId}/{staffProfileId}/{YYYY-MM-DD}_{in|out}.{ext}`
 * Returns null if the key doesn't match.
 */
export function parseAttendanceKey(key: string): {
  tenantId: string
  staffProfileId: string
  date: string
  slot: 'in' | 'out'
} | null {
  const m = key.match(
    /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/(\d{4}-\d{2}-\d{2})_(in|out)\.[a-z0-9]+$/i,
  )
  if (!m) return null
  return {
    tenantId: m[1]!,
    staffProfileId: m[2]!,
    date: m[3]!,
    slot: m[4] as 'in' | 'out',
  }
}
