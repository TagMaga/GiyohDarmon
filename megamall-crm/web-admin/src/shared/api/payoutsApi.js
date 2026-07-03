import client from './client'

const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}

/** GET /payouts/me — payouts received by the current user (seller/manager/team-lead). */
export async function fetchMyPayouts() {
  const res = await client.get('/payouts/me')
  const data = unwrap(res)
  return Array.isArray(data) ? data : []
}

/** GET /payouts/payables/team-lead/:id — "Кому выплатить" list + hero numbers. */
export async function fetchPayables(teamLeadId, params = {}) {
  const res = await client.get(`/payouts/payables/team-lead/${teamLeadId}`, { params })
  return unwrap(res)
}

/** POST /payouts — bulk "Выплатить" action. */
export async function createPayouts(payload) {
  const res = await client.post('/payouts', payload)
  return unwrap(res)
}
