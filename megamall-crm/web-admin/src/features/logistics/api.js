/**
 * Logistics API — Owner Phase 17
 * All endpoints under /api/v1/owner/logistics/
 */
import client from '../../shared/api/client'

const unwrap = (res) => res.data?.data ?? res.data
const unwrapPaginated = (res) => {
  const body = res.data
  const raw  = body?.data ?? body
  return {
    items: Array.isArray(raw) ? raw : [],
    meta:  body?.meta ?? null,
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function fetchLogisticsDashboard() {
  const res = await client.get('/owner/logistics/dashboard')
  return unwrap(res)
}

// ── Couriers ──────────────────────────────────────────────────────────────────

export async function fetchLogisticsCouriers() {
  const res = await client.get('/owner/logistics/couriers')
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

export async function fetchLogisticsCourier(id) {
  const res = await client.get(`/owner/logistics/couriers/${id}`)
  return unwrap(res)
}

export async function fetchCourierOrders(id, params = {}) {
  const res = await client.get(`/owner/logistics/couriers/${id}/orders`, { params })
  return unwrapPaginated(res)
}

export async function fetchCourierPerformance(id, params = {}) {
  const res = await client.get(`/owner/logistics/couriers/${id}/performance`, { params })
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

// ── Cash handovers ────────────────────────────────────────────────────────────

export async function fetchHandovers(params = {}) {
  // Remove undefined/empty params
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null && v !== '')
  )
  const res = await client.get('/owner/logistics/cash-handovers', { params: clean })
  return unwrapPaginated(res)
}

export async function createHandover(body) {
  const res = await client.post('/owner/logistics/cash-handovers', body)
  return unwrap(res)
}

export async function updateHandover(id, body) {
  const res = await client.patch(`/owner/logistics/cash-handovers/${id}`, body)
  return unwrap(res)
}

export async function deleteHandover(id) {
  await client.delete(`/owner/logistics/cash-handovers/${id}`)
}
