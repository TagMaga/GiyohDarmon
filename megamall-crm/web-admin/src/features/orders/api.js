/**
 * Owner Orders API — Phase 16
 *
 * Owner-only endpoints:
 *   GET /orders             — paginated order list with filters
 *   GET /orders/:id         — single order detail
 *   GET /finance/events     — financial events per order (reused from finance)
 *
 * All responses follow { success, data, meta?, error? } envelope.
 */
import client from '../../shared/api/client'

const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}

const unwrapPaginated = (res) => {
  const body = res.data
  const raw  = body?.data ?? body
  return {
    items: Array.isArray(raw) ? raw : (raw?.orders ?? raw?.items ?? []),
    meta:  body?.meta ?? null,
  }
}

/**
 * GET /orders — paginated, filterable order list.
 * Params: { page, limit, status, team_id, seller_id, manager_id, product_id, search, from, to }
 */
export async function fetchOwnerOrders(params = {}) {
  const res = await client.get('/orders', { params })
  // Some backends return plain array, others paginated envelope
  const body = res.data
  if (body !== null && typeof body === 'object' && 'meta' in body) {
    return unwrapPaginated(res)
  }
  // Flat array or envelope without meta
  const items = unwrap(res)
  return {
    items: Array.isArray(items) ? items : (items?.orders ?? []),
    meta: null,
  }
}

/**
 * GET /orders/:id — single order detail with financial breakdown.
 */
export async function fetchOwnerOrder(id) {
  const res = await client.get(`/orders/${id}`)
  return unwrap(res)
}

/**
 * GET /finance/events?order_id=:id — financial events for a specific order.
 */
export async function fetchOrderFinanceEvents(orderId) {
  const res = await client.get('/finance/events', { params: { order_id: orderId, limit: 50 } })
  const body = res.data
  const raw  = body?.data ?? body
  return Array.isArray(raw) ? raw : []
}
