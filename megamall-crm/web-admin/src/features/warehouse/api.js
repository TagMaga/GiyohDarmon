import client from '../../shared/api/client'
import { compressImage } from '../../shared/api/compressImage'
import { isUUID } from './utils/warehouseHelpers'

const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}

const toArray = (data) => (Array.isArray(data) ? data : [])

const UUID_PARAM_KEYS = new Set([
  'product_id',
  'supplier_id',
])

function cleanParams(params = {}) {
  const out = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (UUID_PARAM_KEYS.has(key) && !isUUID(value)) continue
    out[key] = value
  }
  return out
}

function requireUUID(value, label) {
  if (!isUUID(value)) throw new Error(`${label}: invalid UUID`)
  return value
}

function cleanPayload(payload = {}) {
  const out = { ...payload }
  for (const key of UUID_PARAM_KEYS) {
    if (key in out) out[key] = requireUUID(out[key], key)
  }
  return out
}

// ── Products ──────────────────────────────────────────────────────────────────
export async function fetchProducts(params = {}) {
  const res = await client.get('/products', { params: { limit: 500, ...cleanParams(params) } })
  return toArray(unwrap(res))
}

export async function createProduct(payload) {
  const res = await client.post('/products', cleanPayload(payload))
  return unwrap(res)
}

export async function updateProduct(productId, payload) {
  const res = await client.patch(`/products/${requireUUID(productId, 'product_id')}`, cleanPayload(payload))
  return unwrap(res)
}

export async function addProductImage(productId, payload) {
  const res = await client.post(`/products/${requireUUID(productId, 'product_id')}/images`, payload)
  return unwrap(res)
}

// Uploads a file to the shared /uploads endpoint and returns its served URL
// (e.g. "/uploads/<uuid>.jpg"), instead of embedding the image as base64.
// Downscaled client-side first and given extra timeout headroom, since phone-
// camera photos over mobile connections can otherwise exceed the default 12s.
//
// Legacy path — still used as the automatic fallback by
// uploadProductImageSmart below when the centralized media pipeline isn't
// enabled on the server.
export async function uploadImageFile(file) {
  const upload = await compressImage(file)
  const form = new FormData()
  form.append('file', upload)
  const res = await client.post('/uploads', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30_000,
  })
  return unwrap(res) // { url: "/uploads/<filename>" }
}

// Uploads a product image through the centralized media pipeline
// (POST /api/v1/media, category=product_image) — the server validates,
// strips metadata, and generates thumbnail/card/detail WebP variants.
// Returns the full AssetResponse: { id, processing_status, variants: [...] }.
// onProgress, if given, is called with an integer 0-100 as the upload body
// streams (this tracks the upload itself, not server-side processing time,
// which happens synchronously after the body finishes and isn't separately
// observable from the client).
async function uploadProductImageToMedia(file, { onProgress } = {}) {
  const upload = await compressImage(file)
  const form = new FormData()
  form.append('category', 'product_image')
  form.append('file', upload)
  const res = await client.post('/media', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // Longer than the legacy /uploads timeout: the response only comes
    // back after the server finishes libvips processing (resize + WebP ×3
    // variants), not just after the bytes are received.
    timeout: 60_000,
    onUploadProgress: onProgress
      ? (evt) => {
          if (!evt.total) return
          onProgress(Math.round((evt.loaded / evt.total) * 100))
        }
      : undefined,
  })
  return unwrap(res)
}

// uploadProductImageSmart is what UI code should call: it tries the new
// media pipeline first, and transparently falls back to the legacy
// /uploads flow if that route doesn't exist (HTTP 404 — the exact,
// unambiguous signal that MEDIA_PIPELINE_ENABLED=false on the server; see
// internal/media/routes.go, which never registers the route at all when
// disabled). A real validation/processing error from an *enabled* pipeline
// (400/413/500/etc.) is NOT swallowed into a fallback attempt — it's
// thrown as-is so the caller can show the proper Russian message via
// translateMediaError.
//
// Returns either:
//   { kind: 'media', asset: <AssetResponse> }        — new pipeline succeeded
//   { kind: 'legacy', url: '/uploads/<file>' }         — fell back
export async function uploadProductImageSmart(file, { onProgress } = {}) {
  try {
    const asset = await uploadProductImageToMedia(file, { onProgress })
    return { kind: 'media', asset }
  } catch (err) {
    if (err?.response?.status !== 404) throw err
    // Media pipeline route doesn't exist — disabled on the server. Fall
    // back silently; the legacy endpoint has no upload-progress events of
    // its own, so report a jump to 100% once it resolves.
    const { url } = await uploadImageFile(file)
    onProgress?.(100)
    return { kind: 'legacy', url }
  }
}

export async function importProducts(file, dryRun = false) {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post('/products/import', form, {
    params: { dry_run: dryRun ? 'true' : 'false' },
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return unwrap(res)
}

export async function fetchSuppliers() {
  const res = await client.get('/suppliers', { params: { limit: 500 } })
  return toArray(unwrap(res))
}

// ── Inventory ─────────────────────────────────────────────────────────────────
export async function fetchInventory(params = {}) {
  const res = await client.get('/inventory', { params: { limit: 500, ...cleanParams(params) } })
  return toArray(unwrap(res))
}

export async function fetchInventoryByProduct(productId) {
  if (!isUUID(productId)) return []
  const res = await client.get(`/inventory/product/${productId}`)
  return toArray(unwrap(res))
}

// ── Movements ─────────────────────────────────────────────────────────────────
export async function fetchMovements(params = {}) {
  const res = await client.get('/inventory/movements', { params: { limit: 200, ...cleanParams(params) } })
  return toArray(unwrap(res))
}

// ── Batches ───────────────────────────────────────────────────────────────────
export async function fetchBatches(params = {}) {
  const res = await client.get('/inventory/batches', { params: { only_active: 'true', ...cleanParams(params) } })
  return toArray(unwrap(res))
}

// ── Mutations ─────────────────────────────────────────────────────────────────
export async function createAdjustment(payload) {
  const res = await client.post('/inventory/adjustments', cleanPayload(payload))
  return unwrap(res)
}

export async function createReceiving(payload) {
  const res = await client.post('/inventory/receiving', cleanPayload(payload))
  return unwrap(res)
}

export async function updateReceiving(movementId, payload) {
  const res = await client.patch(`/inventory/receiving/${requireUUID(movementId, 'movement_id')}`, cleanPayload(payload))
  return unwrap(res)
}

export async function fetchReceivingHistory(movementId) {
  if (!isUUID(movementId)) return []
  const res = await client.get(`/inventory/receiving/${movementId}/history`)
  return toArray(unwrap(res))
}

export async function createReceipt(payload) {
  const res = await client.post('/inventory/adjustments', cleanPayload(payload))
  return unwrap(res)
}

export async function createWriteoff(payload) {
  const res = await client.post('/inventory/writeoffs', cleanPayload(payload))
  return unwrap(res)
}
