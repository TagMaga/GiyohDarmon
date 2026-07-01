import client from '../../shared/api/client'

const unwrap = (res) => {
  const body = res.data
  if (body !== null && typeof body === 'object' && 'data' in body) return body.data
  return body
}

const unwrapPaginated = (res) => {
  const body = res.data
  const raw  = body?.data ?? body
  return { items: Array.isArray(raw) ? raw : [], meta: body?.meta ?? null }
}

export const fetchBudgetSummary = (params = {}) =>
  client.get('/owner/budget/summary', { params }).then(unwrap)

export const fetchBudgetTransactions = (params = {}) =>
  client.get('/owner/budget/transactions', { params }).then(unwrapPaginated)

export const postBudgetIncome = (body) =>
  client.post('/owner/budget/income', body).then(unwrap)

export const postBudgetWithdrawal = (body) =>
  client.post('/owner/budget/withdrawal', body).then(unwrap)

export const patchBudgetTransaction = ({ id, ...body }) =>
  client.patch(`/owner/budget/transaction/${id}`, body).then(unwrap)

export const fetchBudgetTransactionHistory = (id) =>
  client.get(`/owner/budget/transaction/${id}/history`).then((res) => res.data?.data ?? [])

export const fetchBudgetCreators = () =>
  client.get('/owner/budget/creators').then((res) => res.data?.data ?? [])
