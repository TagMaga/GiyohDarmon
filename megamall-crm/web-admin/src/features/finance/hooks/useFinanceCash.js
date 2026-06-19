import { useQuery }       from '@tanstack/react-query'
import { KEYS }            from '../../../shared/queryKeys'
import { fetchFinanceCash } from '../api'

/**
 * useFinanceCash — GET /finance/cash?from=&to=&page=&limit=
 *
 * Returns { items, meta } where:
 *   items — FinanceCashHandoverResponse[]
 *   meta  — { page, limit, total, total_pages } | null
 *
 * @param {object} params  { from?, to?, page?, limit? }
 */
export default function useFinanceCash(params = {}) {
  return useQuery({
    queryKey: KEYS.finance.cash(params),
    queryFn:  () => fetchFinanceCash(params),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })
}
