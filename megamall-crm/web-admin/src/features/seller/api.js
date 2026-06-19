import client from '../../shared/api/client'

/**
 * Unwrap an Axios response into the actual payload array/object.
 * Handles:
 *   1. Envelope  { success, data: X }  → return X
 *   2. Raw array or object             → return as-is
 */
const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}

// ── Orders ────────────────────────────────────────────────────────────────────
/** GET /orders — backend filters by JWT role automatically */
export async function fetchSellerOrders(params = {}) {
  const res = await client.get('/orders', { params: { limit: 200, ...params } })
  return unwrap(res)
}

/** GET /orders/:id */
export async function fetchOrder(id) {
  const res = await client.get(`/orders/${id}`)
  return unwrap(res)
}

/** POST /orders */
export async function createOrder(payload) {
  const res = await client.post('/orders', payload)
  return unwrap(res)
}

/** POST /orders/:id/prepayments */
export async function addPrepayment(orderId, amount) {
  const res = await client.post(`/orders/${orderId}/prepayments`, { amount })
  return unwrap(res)
}

// ── Customers ─────────────────────────────────────────────────────────────────
/** GET /customers?limit=500 */
export async function fetchCustomers() {
  const res = await client.get('/customers', { params: { limit: 500 } })
  return unwrap(res)
}

/** POST /customers */
export async function createCustomer(payload) {
  const res = await client.post('/customers', payload)
  return unwrap(res)
}

// ── Products ──────────────────────────────────────────────────────────────────
/** GET /products?limit=200&is_active=true */
export async function fetchProducts() {
  const res = await client.get('/products', { params: { limit: 200, is_active: true } })
  return unwrap(res)
}

// ── Delivery settings ─────────────────────────────────────────────────────────
/** GET /settings/delivery */
export async function fetchDeliverySettings() {
  const res = await client.get('/settings/delivery')
  return unwrap(res)
}

/** PUT /settings/delivery */
export async function updateDeliverySettings(payload) {
  const res = await client.put('/settings/delivery', payload)
  return unwrap(res)
}

// ── Cities ────────────────────────────────────────────────────────────────────
/** GET /cities — active delivery cities */
export async function fetchCities() {
  const res = await client.get('/cities')
  const parsed = unwrap(res)
  return Array.isArray(parsed) ? parsed : []
}

// ── Warehouses ────────────────────────────────────────────────────────────────
/** GET /warehouses */
export async function fetchWarehouses() {
  const res = await client.get('/warehouses')
  const parsed = unwrap(res)
  if (Array.isArray(parsed)) return parsed
  return []
}

// ── Inventory ─────────────────────────────────────────────────────────────────
/** GET /inventory?product_id=&warehouse_id= */
export async function fetchInventory(productId, warehouseId) {
  const res = await client.get('/inventory', {
    params: { product_id: productId, warehouse_id: warehouseId, limit: 1 },
  })
  // Returns array; grab first item
  const data = unwrap(res)
  return Array.isArray(data) ? data[0] ?? null : data
}
