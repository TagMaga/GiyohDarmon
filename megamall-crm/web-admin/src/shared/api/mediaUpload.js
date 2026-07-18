import client from './client'
import { compressImage } from './compressImage'

// uploadToMedia uploads a file through the centralized media pipeline
// (POST /api/v1/media) for the given category. Mirrors
// features/warehouse/api.js's uploadProductImageToMedia — see that file's
// doc comment for the full rationale (compress client-side first, longer
// timeout since the response only comes back after server-side processing,
// onProgress tracks only the upload leg).
export async function uploadToMedia(file, category, { onProgress, timeout = 60_000 } = {}) {
  const upload = await compressImage(file)
  const form = new FormData()
  form.append('category', category)
  form.append('file', upload)
  const res = await client.post('/media', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout,
    onUploadProgress: onProgress
      ? (evt) => {
          if (!evt.total) return
          onProgress(Math.round((evt.loaded / evt.total) * 100))
        }
      : undefined,
  })
  return res.data?.data ?? res.data // AssetResponse: { id, processing_status, variants: [...] }
}

// smartUpload tries the media pipeline first and transparently falls back
// to legacyUpload(file) when the route doesn't exist (HTTP 404 — the exact
// signal that MEDIA_PIPELINE_ENABLED=false server-side; see
// internal/media/routes.go). A real validation/processing error from an
// *enabled* pipeline (400/413/500/etc.) is thrown as-is, not swallowed —
// callers should render it via translateMediaError.
//
// PUBLIC categories only (currently just product_image, via
// features/warehouse/api.js's uploadProductImageSmart) — the legacy
// /uploads endpoint it falls back to is unauthenticated and publicly
// readable. PRIVATE categories (avatar, order_attachment,
// prepayment_proof, cash_handover_proof, user_document) must call
// uploadToMedia directly and let a failure propagate — see each domain's
// api.js (e.g. seller/api.js's uploadMyAvatarSecure) for the pattern, and
// scripts/verify-private-media-no-legacy-fallback.sh for the regression
// guard that enforces this only warehouse/api.js imports this function.
//
// Returns either:
//   { kind: 'media', asset: <AssetResponse> }
//   { kind: 'legacy', ...legacyUpload's own return value }
export async function smartUpload(file, category, legacyUpload, { onProgress } = {}) {
  try {
    const asset = await uploadToMedia(file, category, { onProgress })
    return { kind: 'media', asset }
  } catch (err) {
    if (err?.response?.status !== 404) throw err
    const legacy = await legacyUpload(file)
    onProgress?.(100)
    return { kind: 'legacy', ...legacy }
  }
}

// withCacheBust appends a cache-busting query param to a media URL. Unlike
// the old plain-URL era (a stable /uploads/<file> path where blindly
// concatenating "?t=..." was safe because that path never had a query
// string of its own), a media-pipeline signed URL already carries its own
// query string (?sig=...&expires=...&variant=...) — naively appending a
// second "?t=..." after it would corrupt the signature verification, since
// everything after the first "?" is one query string. This picks "&" when
// url already has a "?", "?" otherwise, so it works for both.
export function withCacheBust(url, token) {
  if (!url) return null
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}t=${token ?? ''}`
}

// previewVariantUrl finds a usable preview URL in a freshly-uploaded
// AssetResponse's variants array — 'preview' for private image categories
// (see internal/media's ProcessPrivateProofPreview), falling back to
// 'card' (public product images) or 'original' (documents, or anything
// else that has no named variant).
export function previewVariantUrl(asset) {
  const variants = asset?.variants ?? []
  const byName = (name) => variants.find((v) => v.variant === name)?.url
  return byName('preview') || byName('card') || byName('original') || null
}
