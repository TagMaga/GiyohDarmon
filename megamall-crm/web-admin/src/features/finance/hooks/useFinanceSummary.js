import { useQuery }          from '@tanstack/react-query'
import { KEYS }               from '../../../shared/queryKeys'
import { fetchFinanceSummary } from '../api'

/**
 * useFinanceSummary — GET /finance/summary?from=&to=
 *
 * Returns the full FinanceSummaryResponse: { period, orders, revenue, cash }.
 * Refetched whenever params changes (period filter).
 *
 * @param {object} params  { from?: string, to?: string }
 */
export default function useFinanceSummary(params = {}) {
  return useQuery({
    queryKey: KEYS.finance.summary(params),
    queryFn:  () => fetchFinanceSummary(params),
    staleTime: 60_000,
  })
}
