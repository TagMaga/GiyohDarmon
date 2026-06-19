import client from '../../shared/api/client'

const unwrap = (res) => {
  const body = res.data
  if (body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) return body.data
  return body
}

/**
 * GET /orders/stats?from=&to= — order-health breakdown for the owner dashboard.
 * Returns { by_status: {status: count}, unassigned, scheduled, total }.
 */
export async function fetchOrderStats(params = {}) {
  const res = await client.get('/orders/stats', { params })
  return unwrap(res)
}

/**
 * GET /finance/daily?from=&to=
 * Returns DailyPoint[] — one entry per calendar day with orders_count,
 * total_sales, delivery_fees, company_revenue.
 */
export async function fetchFinanceDaily(params = {}) {
  const res = await client.get('/finance/daily', { params })
  return unwrap(res)
}

/**
 * GET /finance/sellers?from=&to=&limit=
 * Returns SellerPerformanceRow[] ranked by total_revenue DESC.
 */
export async function fetchSellerLeaderboard(params = {}) {
  const res = await client.get('/finance/sellers', { params })
  return unwrap(res)
}

/**
 * GET /finance/teams?from=&to=
 * Returns TeamPerformanceRow[] ranked by total_revenue DESC.
 */
export async function fetchTeamPerformance(params = {}) {
  const res = await client.get('/finance/teams', { params })
  return unwrap(res)
}
