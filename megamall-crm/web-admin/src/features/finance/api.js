/**
 * Finance API — Phase 15.2
 *
 * Owner-only endpoints:
 *   GET /finance/summary?from=&to=
 *   GET /finance/events?from=&to=&event_type=&order_id=&user_id=&min_amount=&max_amount=&page=&limit=
 *   GET /finance/cash?from=&to=&page=&limit=
 *
 * /finance/summary returns a plain object → use unwrap (body.data).
 * /finance/events and /finance/cash return OKWithMeta → we need both
 *   body.data (items array) and body.meta (pagination). Use unwrapPaginated.
 */
import client from '../../shared/api/client'

/** Extracts body.data from { success, data, meta?, error? } */
const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && !Array.isArray(body) && 'data' in body) {
    return body.data
  }
  return body
}

/** Extracts { items, meta } from a paginated OKWithMeta response. */
const unwrapPaginated = (res) => {
  const body = res.data
  const raw  = body?.data ?? body
  return {
    items: Array.isArray(raw) ? raw : [],
    meta:  body?.meta ?? null,
  }
}

// ── Finance Summary ───────────────────────────────────────────────────────────

/**
 * Fetch the finance summary for a period.
 * Returns FinanceSummaryResponse: { period, orders, revenue, cash }.
 *
 * @param {object} params  { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
 */
export async function fetchFinanceSummary(params = {}) {
  const res = await client.get('/finance/summary', { params })
  return unwrap(res)
}

// ── Finance Events ────────────────────────────────────────────────────────────

/**
 * Fetch paginated financial events for the owner ledger view.
 * Returns { items: FinanceEventResponse[], meta: { page, limit, total, total_pages } }.
 *
 * @param {object} params  { from?, to?, event_type?, order_id?, user_id?, min_amount?, max_amount?, page?, limit? }
 */
export async function fetchFinanceEvents(params = {}) {
  const res = await client.get('/finance/events', { params })
  return unwrapPaginated(res)
}

// ── Finance Cash Handovers ────────────────────────────────────────────────────

/**
 * Fetch paginated cash handover rows.
 * Returns { items: FinanceCashHandoverResponse[], meta: { page, limit, total, total_pages } }.
 *
 * @param {object} params  { from?, to?, page?, limit? }
 */
export async function fetchFinanceCash(params = {}) {
  const res = await client.get('/finance/cash', { params })
  return unwrapPaginated(res)
}

// ── Business expenses (salaries, rent, marketing, taxes, other) ──────────────

export const postFinanceExpense = (body) =>
  client.post('/finance/expenses', body).then(unwrap)

export const patchFinanceExpense = ({ id, ...body }) =>
  client.patch(`/finance/expenses/${id}`, body).then(unwrap)

export const fetchFinanceExpenseHistory = (id) =>
  client.get(`/finance/expenses/${id}/history`).then((res) => res.data?.data ?? [])
