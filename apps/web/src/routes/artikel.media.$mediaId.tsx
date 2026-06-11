/**
 * Article image proxy (issue #206). Serves an article image from S3
 * under a stable, Cloudflare-cacheable URL so stored article HTML can
 * embed it permanently. Server-only route — no component.
 *
 * The proxy (rather than a signed S3 URL) is what keeps the embedded
 * `<img src>` valid forever; the bytes are immutable per uuid key, so
 * the long `immutable` cache header means the app only ever serves a
 * cache-miss — almost everything is answered at the edge.
 */
import { createFileRoute } from '@tanstack/react-router'
import { getArticleImage } from '@/lib/s3-storage'

export const Route = createFileRoute('/artikel/media/$mediaId')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const mediaId = decodeURIComponent(
          new URL(request.url).pathname.split('/').pop() ?? '',
        )
        const img = await getArticleImage(mediaId)
        if (!img) return new Response('Not found', { status: 404 })
        // Copy into a fresh ArrayBuffer-backed view — the S3 SDK hands
        // back a Uint8Array<ArrayBufferLike>, which BodyInit rejects.
        return new Response(new Blob([new Uint8Array(img.bytes)]), {
          headers: {
            'content-type': img.contentType,
            'cache-control': 'public, max-age=31536000, immutable',
          },
        })
      },
    },
  },
})
