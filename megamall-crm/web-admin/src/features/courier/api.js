import client from '../../shared/api/client'

/**
 * Unwrap { success, data: X } envelope or return body as-is.
 * Handles both parsed objects (normal axios) and raw arrays.
 */
const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}

// ── My orders ─────────────────────────────────────────────────────────────────
/** GET /courier/me */
export async function fetchCourierMe() {
  const res = await client.get('/courier/me')
  return unwrap(res)
}

/** GET /courier/my-orders */
export async function fetchMyOrders() {
  const res = await client.get('/courier/my-orders')
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

// ── Available orders ──────────────────────────────────────────────────────────
/** GET /courier/available */
export async function fetchAvailableOrders() {
  const res = await client.get('/courier/available')
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

/** POST /courier/available/:id/claim */
export async function claimOrder(id) {
  const res = await client.post(`/courier/available/${id}/claim`)
  return unwrap(res)
}

// ── Order actions ─────────────────────────────────────────────────────────────
/** POST /courier/orders/:id/start */
export async function startDelivery(id) {
  const res = await client.post(`/courier/orders/${id}/start`)
  return unwrap(res)
}

/** POST /courier/orders/:id/delivered */
export async function markDelivered(id, payload = {}) {
  const res = await client.post(`/courier/orders/${id}/delivered`, payload)
  return unwrap(res)
}

/** POST /courier/orders/:id/returned */
export async function markReturned(id, payload = {}) {
  const res = await client.post(`/courier/orders/${id}/returned`, payload)
  return unwrap(res)
}

/** POST /courier/orders/:id/issue */
export async function markIssue(id, payload = {}) {
  const res = await client.post(`/courier/orders/${id}/issue`, payload)
  return unwrap(res)
}

/** POST /courier/orders/:id/attempt */
export async function addAttempt(id, payload) {
  const res = await client.post(`/courier/orders/${id}/attempt`, payload)
  return unwrap(res)
}

// ── Cash ──────────────────────────────────────────────────────────────────────
/** GET /courier/cash/summary */
export async function fetchCashSummary() {
  const res = await client.get('/courier/cash/summary')
  return unwrap(res)
}

/** POST /courier/cash/handover */
export async function submitHandover(payload) {
  const res = await client.post('/courier/cash/handover', payload)
  return unwrap(res)
}

/** GET /courier/cash/handovers */
export async function fetchMyHandovers() {
  const res = await client.get('/courier/cash/handovers')
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}
