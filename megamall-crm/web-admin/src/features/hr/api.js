import client from '../../shared/api/client'

const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}
const toArray = (data) => (Array.isArray(data) ? data : [])

// ── Tariffs ───────────────────────────────────────────────────────────────────
export async function fetchActiveTariff() {
  const res = await client.get('/hr/tariffs/active')
  return unwrap(res)
}

export async function fetchTariffs() {
  const res = await client.get('/hr/tariffs')
  return toArray(unwrap(res))
}

export async function createTariff(payload) {
  const res = await client.post('/hr/tariffs', payload)
  return unwrap(res)
}

export async function deactivateTariff(id, payload) {
  const res = await client.post(`/hr/tariffs/${id}/deactivate`, payload)
  return unwrap(res)
}

// ── Compensation configs ──────────────────────────────────────────────────────
export async function fetchConfigs(params = {}) {
  const res = await client.get('/hr/compensation/configs', { params })
  return toArray(unwrap(res))
}

export async function createConfig(payload) {
  const res = await client.post('/hr/compensation/configs', payload)
  return unwrap(res)
}

export async function disableConfig(id, payload) {
  const res = await client.post(`/hr/compensation/configs/${id}/disable`, payload)
  return unwrap(res)
}

// ── History ───────────────────────────────────────────────────────────────────
export async function fetchHistory(params = {}) {
  const res = await client.get('/hr/compensation/history', { params: { limit: 100, ...params } })
  // May be paginated — return { data, meta } or array
  const body = unwrap(res)
  if (Array.isArray(body)) return { items: body, total: body.length }
  return {
    items: toArray(body?.data ?? body?.items ?? body),
    total: body?.meta?.total ?? body?.total ?? 0,
  }
}

// ── Employee / Team drilldown ─────────────────────────────────────────────────
export async function fetchEmployeeConfigs(userId, params = {}) {
  const res = await client.get(`/hr/compensation/employees/${userId}`, { params })
  return toArray(unwrap(res))
}

export async function fetchTeamConfigs(teamId, params = {}) {
  const res = await client.get(`/hr/compensation/teams/${teamId}`, { params })
  return toArray(unwrap(res))
}

// ── Preview calculator ────────────────────────────────────────────────────────
export async function fetchPreview(params) {
  const res = await client.get('/hr/compensation/preview', { params })
  return unwrap(res)
}

// ── Financial events (by order) ───────────────────────────────────────────────
export async function fetchEventsByOrder(orderId) {
  const res = await client.get('/hr/events', { params: { order_id: orderId } })
  // ListEvents returns OKWithMeta → { data: [...], meta: {...} }
  // unwrap extracts body.data → the array
  return toArray(unwrap(res))
}

// ── Income reports (Phase 14) ─────────────────────────────────────────────────

/**
 * Fetch income report for the authenticated user.
 * @param {object} params  { from?, to?, event_type?, include_events? }
 */
export async function fetchMyIncome(params = {}) {
  const res = await client.get('/hr/income/me', { params })
  return unwrap(res)
}

/**
 * Fetch income report for a specific user (RBAC enforced by backend).
 * @param {string} userId
 * @param {object} params  { from?, to?, event_type?, include_events? }
 */
export async function fetchUserIncome(userId, params = {}) {
  const res = await client.get(`/hr/income/users/${userId}`, { params })
  return unwrap(res)
}

/**
 * Fetch aggregated team income.
 * :teamLeadId is the team lead's user_id (not a teams table PK).
 * @param {string} teamLeadId
 * @param {object} params  { from?, to? }
 */
export async function fetchTeamIncome(teamLeadId, params = {}) {
  const res = await client.get(`/hr/income/teams/${teamLeadId}`, { params })
  return unwrap(res)
}

// ── Supporting data ───────────────────────────────────────────────────────────
export async function fetchTeams() {
  const res = await client.get('/teams')
  return toArray(unwrap(res))
}

export async function fetchUsers() {
  const res = await client.get('/users')
  return toArray(unwrap(res))
}
