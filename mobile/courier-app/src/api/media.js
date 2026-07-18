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

// securePrivateUpload uploads through the centralized media pipeline only.
// Cash-handover proofs are a PRIVATE category — this must never fall back
// to the legacy, unauthenticated POST /uploads endpoint (that endpoint
// saves publicly-readable files with no auth on the read side; see
// web-admin's shared/api/mediaUpload.js doc comment and the 2026-07-16 P0
// incident it references: a private file already leaked through that
// exact class of unauthenticated legacy storage once). If the pipeline is
// unavailable (HTTP 404 — MEDIA_PIPELINE_ENABLED=false server-side) or
// rejects the file, this throws and the caller must show a clear error and
// stop, never silently upload elsewhere.
export async function securePrivateUpload(file, category) {
  const asset = await uploadToMedia(file, category)
  return { kind: 'media', asset }
}
