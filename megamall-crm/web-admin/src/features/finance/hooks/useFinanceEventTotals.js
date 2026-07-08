import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchFinanceEvents } from '../api'
import { INCOME_EVENT_TYPES, EXPENSE_EVENT_TYPES } from '../../hr/utils/hrHelpers'

// The backend hard-caps `limit` at 100 (pkg/pagination.MaxLimit) regardless
// of what's requested, so a single "give me everything" fetch silently
// truncates to the most recent 100 rows. To get an accurate Расходы/Доходы
// total for the whole period we page through the ledger and sum client-side.
// MAX_PAGES bounds worst-case request fan-out for very wide date ranges
// (e.g. "Максимум") — 100 pages covers up to 10,000 events, comfortably
// beyond any realistic owner-scale query.
const PAGE_LIMIT = 100
const MAX_PAGES = 100

// direction/expenseCategory aren't backend query params (business_expense
// category isn't filterable server-side, direction is just a client grouping
// of event types) — they're applied here, after the fetch, same as the
// ledger table's own visibleItems filter.
function sumInto(items, totals, { direction, expenseCategory } = {}) {
  items.forEach((ev) => {
    if (expenseCategory && ev.expense_category !== expenseCategory) return
    const isIncome = INCOME_EVENT_TYPES.has(ev.event_type)
    const isExpense = EXPENSE_EVENT_TYPES.has(ev.event_type)
    if (direction === 'income' && !isIncome) return
    if (direction === 'expense' && !isExpense) return
    if (isIncome) totals.income += Number(ev.amount || 0)
    else if (isExpense) totals.expense += Number(ev.amount || 0)
  })
}

async function fetchAllTotals({ direction, expenseCategory, ...queryParams }) {
  const totals = { income: 0, expense: 0 }
  const refine = { direction, expenseCategory }
  const first = await fetchFinanceEvents({ ...queryParams, page: 1, limit: PAGE_LIMIT })
  sumInto(first.items, totals, refine)

  const totalPages = Math.min(first.meta?.total_pages ?? 1, MAX_PAGES)
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => fetchFinanceEvents({ ...queryParams, page: i + 2, limit: PAGE_LIMIT }))
    )
    rest.forEach((page) => sumInto(page.items, totals, refine))
  }

  return totals
}

/**
 * useFinanceEventTotals — accurate Расходы/Доходы sums for the ledger's
 * current filter state, classified by the same INCOME_EVENT_TYPES/
 * EXPENSE_EVENT_TYPES the ledger's own Пополнение/Списание filter uses.
 * Pages through the full result set (see MAX_PAGES) rather than relying on
 * a single capped fetch.
 *
 * @param {object} params  { from?, to?, event_type?, order_id?, user_id?,
 *   min_amount?, max_amount?, direction?, expenseCategory? }
 * Returns { income: number, expense: number }.
 */
export default function useFinanceEventTotals(params = {}) {
  return useQuery({
    queryKey: KEYS.finance.eventTotals(params),
    queryFn:  () => fetchAllTotals(params),
    staleTime: 60_000,
  })
}
