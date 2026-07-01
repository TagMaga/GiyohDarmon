import { useQuery }         from '@tanstack/react-query'
import { KEYS }              from '../../../shared/queryKeys'
import { fetchFinanceEvents } from '../api'

/**
 * useFinanceEvents — GET /finance/events?from=&to=&event_type=&order_id=&user_id=&min_amount=&max_amount=&page=&limit=
 *
 * Returns { items, meta } where:
 *   items — FinanceEventResponse[]
 *   meta  — { page, limit, total, total_pages } | null
 *
 * @param {object} params  { from?, to?, event_type?, order_id?, user_id?, min_amount?, max_amount?, page?, limit? }
 */
export default function useFinanceEvents(params = {}) {
  return useQuery({
    queryKey: KEYS.finance.events(params),
    queryFn:  () => fetchFinanceEvents(params),
    staleTime: 60_000,
    placeholderData: (prev) => prev,   // keep old data visible while refetching page
  })
}
