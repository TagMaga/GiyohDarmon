import client from './client'

// uploadToMedia uploads a React Native picker asset ({ uri, type, name })
// through the centralized media pipeline (POST /api/v1/media) for the
// given category. Mirrors web-admin's shared/api/mediaUpload.js.
export async function uploadToMedia(file, category) {
  const form = new FormData()
  form.append('category', category)
  form.append('file', file)
  const res = await client.post('/media', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  return res.data?.data ?? res.data // AssetResponse: { id, processing_status, variants: [...] }
}

// uploadFileLegacy uploads through the generic pre-Phase-1 POST /uploads
// endpoint — used as smartUpload's fallback when the pipeline is disabled.
export async function uploadFileLegacy(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post('/uploads', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  const data = res.data?.data ?? res.data
  return { url: data?.url }
}

// smartUpload tries the media pipeline first and transparently falls back
// to uploadFileLegacy when the route doesn't exist (HTTP 404 — the exact
// signal that MEDIA_PIPELINE_ENABLED=false server-side; see
// internal/media/routes.go). A real validation/processing error from an
// *enabled* pipeline (400/413/500/etc.) is thrown as-is, not swallowed.
//
// Returns either:
//   { kind: 'media', asset: <AssetResponse> }
//   { kind: 'legacy', url: string }
export async function smartUpload(file, category) {
  try {
    const asset = await uploadToMedia(file, category)
    return { kind: 'media', asset }
  } catch (err) {
    if (err?.response?.status !== 404) throw err
    const { url } = await uploadFileLegacy(file)
    return { kind: 'legacy', url }
  }
}
