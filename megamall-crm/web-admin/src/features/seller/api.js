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

// ── Inventory ─────────────────────────────────────────────────────────────────
/** GET /inventory?product_id= */
export async function fetchInventory(productId) {
  const res = await client.get('/inventory', {
    params: { product_id: productId, limit: 1 },
  })
  const data = unwrap(res)
  return Array.isArray(data) ? data[0] ?? null : data
}

// ── Me (self-service) ─────────────────────────────────────────────────────────
/** GET /users/me */
export async function fetchMe() {
  const res = await client.get('/users/me')
  return unwrap(res)
}

/** PATCH /users/me */
export async function patchMe(payload) {
  const res = await client.patch('/users/me', payload)
  return unwrap(res)
}

/** GET /hr/compensation/me */
export async function fetchMyCompensation() {
  const res = await client.get('/hr/compensation/me')
  return unwrap(res)
}

/** GET /hr/income/me/team-rank */
export async function fetchMyTeamRank() {
  const res = await client.get('/hr/income/me/team-rank')
  return unwrap(res)
}

// ── Payouts ───────────────────────────────────────────────────────────────────
/** GET /seller-payouts/me */
export async function fetchMyPayouts() {
  const res = await client.get('/payouts/me')
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

// ── Order comments ────────────────────────────────────────────────────────────
/** GET /orders/:id/comments */
export async function fetchOrderComments(orderId) {
  const res = await client.get(`/orders/${orderId}/comments`)
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

/** POST /orders/:id/comments */
export async function addOrderComment(orderId, comment) {
  const res = await client.post(`/orders/${orderId}/comments`, { comment })
  return unwrap(res)
}

/** PATCH /orders/:id */
export async function updateOrder(orderId, payload) {
  const res = await client.patch(`/orders/${orderId}`, payload)
  return unwrap(res)
}
