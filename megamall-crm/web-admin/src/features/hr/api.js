import client from '../../shared/api/client'

const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}
const toArray = (data) => (Array.isArray(data) ? data : [])

// ── Compensation configs (read-only — used for the global-rate display on
//    TeamProfilePage; editing lives in features/people, see PersonalRateModal) ──
export async function fetchConfigs(params = {}) {
  const res = await client.get('/hr/compensation/configs', { params })
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
