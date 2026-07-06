/**
 * People Hub API
 * Covers: users, teams, hierarchy, compensation configs, tariffs, orders (performance)
 */
import client from '../../shared/api/client'

const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}
const toArray = (data) => (Array.isArray(data) ? data : [])

// ── Users ─────────────────────────────────────────────────────────────────────

export async function fetchEmployees(params = {}) {
  const res = await client.get('/users', { params: { limit: 200, ...params } })
  return toArray(unwrap(res))
}

export async function fetchEmployee(userId) {
  const res = await client.get(`/users/${userId}`)
  return unwrap(res)
}

export async function fetchEmployeesBatch(ids = []) {
  if (!ids.length) return []
  const params = new URLSearchParams()
  ids.forEach(id => params.append('ids[]', id))
  params.set('limit', '200')
  const res = await client.get(`/users?${params.toString()}`)
  return toArray(unwrap(res))
}

export async function createEmployee(payload) {
  const res = await client.post('/users', payload)
  return unwrap(res)
}

export async function updateEmployee(userId, payload) {
  const res = await client.patch(`/users/${userId}`, payload)
  return unwrap(res)
}

// ── Teams ─────────────────────────────────────────────────────────────────────

export async function fetchTeams(params = {}) {
  const res = await client.get('/teams', { params: { limit: 200, ...params } })
  return toArray(unwrap(res))
}

export async function createTeam(payload) {
  const res = await client.post('/teams', payload)
  return unwrap(res)
}

export async function updateTeam(teamId, payload) {
  const res = await client.patch(`/teams/${teamId}`, payload)
  return unwrap(res)
}

export async function deleteTeam(teamId) {
  await client.delete(`/teams/${teamId}`)
}

// ── Hierarchy ─────────────────────────────────────────────────────────────────

export async function assignHierarchy(payload) {
  // payload: { user_id, parent_id?, team_id? }
  const res = await client.post('/hierarchy/assign', payload)
  return unwrap(res)
}

export async function fetchUserChain(userId) {
  const res = await client.get(`/hierarchy/user/${userId}`)
  const body = unwrap(res)
  return toArray(body?.chain ?? body)
}

export async function fetchTeamMembers(teamId) {
  const res = await client.get(`/hierarchy/team/${teamId}/members`)
  const body = unwrap(res)
  return toArray(body?.members ?? body)
}

// ── Compensation configs ──────────────────────────────────────────────────────

export async function fetchGlobalRates() {
  const res = await client.get('/hr/compensation/global')
  return unwrap(res)
}

export async function fetchAllConfigs(params = {}) {
  const res = await client.get('/hr/compensation/configs', { params: { limit: 200, ...params } })
  return toArray(unwrap(res))
}

export async function createConfig(payload) {
  const res = await client.post('/hr/compensation/configs', payload)
  return unwrap(res)
}

export async function disableConfig(configId, payload) {
  const res = await client.post(`/hr/compensation/configs/${configId}/disable`, payload)
  return unwrap(res)
}

export async function fetchEmployeeConfigs(userId) {
  const res = await client.get(`/hr/compensation/employees/${userId}`)
  return toArray(unwrap(res))
}

export async function fetchEmployeeConfigHistory(userId) {
  const res = await client.get('/hr/compensation/history', {
    params: { scope: 'employee', user_id: userId, limit: 50 },
  })
  return toArray(unwrap(res))
}

export async function fetchTeamConfigs(teamId) {
  const res = await client.get(`/hr/compensation/teams/${teamId}`)
  return toArray(unwrap(res))
}

// ── Delivery tariff ───────────────────────────────────────────────────────────

export async function fetchActiveTariff() {
  const res = await client.get('/hr/tariffs/active')
  return unwrap(res)
}

// ── Orders (performance) ──────────────────────────────────────────────────────

export async function fetchEmployeeOrders(userId, role, params = {}) {
  // Choose the right filter key depending on the employee's role
  const filterKey =
    role === 'sales_team_lead' ? 'team_lead_id'
    : role === 'manager'       ? 'manager_id'
    : 'seller_id'
  const res = await client.get('/orders', {
    params: { [filterKey]: userId, limit: 200, ...params },
  })
  return toArray(unwrap(res))
}

export async function fetchTeamOrders(teamLeadId, params = {}) {
  const res = await client.get('/orders', {
    params: { team_lead_id: teamLeadId, limit: 200, ...params },
  })
  return toArray(unwrap(res))
}

// ── Cities + courier payout (Phase 2) ──────────────────────────────────────────

export async function fetchCities(params = {}) {
  const res = await client.get('/cities', { params })
  return toArray(unwrap(res))
}

export async function fetchCourierPayout(courierId) {
  const res = await client.get(`/couriers/${courierId}/payout`)
  return unwrap(res)
}

export async function updateCourierPayout(courierId, payload) {
  // payload: { payout_normal, payout_fast, is_active, city_ids: [] }
  const res = await client.put(`/couriers/${courierId}/payout`, payload)
  return unwrap(res)
}

// ── Avatar upload ─────────────────────────────────────────────────────────────

export async function uploadUserAvatar(userId, file) {
  const form = new FormData()
  form.append('avatar', file)
  const res = await client.post(`/users/${userId}/avatar`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return unwrap(res)
}

export async function uploadFile(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await client.post('/uploads', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return unwrap(res)
}

export async function fetchUserDocuments(userId) {
  const res = await client.get(`/users/${userId}/documents`)
  return toArray(unwrap(res))
}

export async function createUserDocument(userId, payload) {
  const res = await client.post(`/users/${userId}/documents`, payload)
  return unwrap(res)
}

export async function deleteUserDocument(userId, documentId) {
  await client.delete(`/users/${userId}/documents/${documentId}`)
}

export async function updateUserDocumentStatus(userId, documentId, verificationStatus) {
  const res = await client.patch(`/users/${userId}/documents/${documentId}/status`, {
    verification_status: verificationStatus,
  })
  return unwrap(res)
}

export async function fetchUserHistory(userId) {
  const res = await client.get(`/users/${userId}/history`)
  return toArray(unwrap(res))
}

export async function fetchAllUserHistory() {
  const res = await client.get('/users/history')
  return toArray(unwrap(res))
}

// ── Employee compensation (fixed salary) ──────────────────────────────────────

export async function fetchEmployeeCompensation(userId) {
  const res = await client.get(`/hr/compensation/employees/${userId}/salary`)
  const body = res.data
  // response.OK with nil data uses `omitempty`, so "data" key is absent → treat as null
  if (body && typeof body === 'object' && !('data' in body) && body.success) return null
  return body?.data ?? null
}

export async function fetchEmployeeCompensationHistory(userId) {
  const res = await client.get(`/hr/compensation/employees/${userId}/salary/history`)
  return toArray(unwrap(res))
}

export async function setEmployeeCompensation(userId, body) {
  const res = await client.post(`/hr/compensation/employees/${userId}/salary`, body)
  return unwrap(res)
}
