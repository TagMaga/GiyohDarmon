import client from './client'

// uploadFileLegacy uploads a file through the generic pre-Phase-1
// POST /uploads endpoint (no category, no signed-URL delivery) — the
// fallback legacyUpload function passed to shared/api/mediaUpload.js's
// smartUpload wherever a feature doesn't already have its own bespoke
// legacy upload helper.
export async function uploadFileLegacy(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post('/uploads', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  const body = res.data
  const data = body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body ? body.data : body
  return { url: data?.url } // matches smartUpload's `{ kind: 'legacy', ...legacy }` spread contract
}
