import client from '../../shared/api/client'
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

export async function createReceipt(payload) {
  const res = await client.post('/inventory/adjustments', cleanPayload(payload))
  return unwrap(res)
}

export async function createWriteoff(payload) {
  const res = await client.post('/inventory/writeoffs', cleanPayload(payload))
  return unwrap(res)
}
