import { useQuery } from '@tanstack/react-query'
import { fetchOrderStats } from '../api'

/**
 * useOrderStats — GET /orders/stats?from=&to=
 * Order-health breakdown for the owner dashboard. Refetches on period change.
 *
 * @param {object} params { from?: 'YYYY-MM-DD', to?: 'YYYY-MM-DD' }
 */
export default function useOrderStats(params = {}) {
  return useQuery({
    queryKey: ['orders', 'stats', params],
    queryFn:  () => fetchOrderStats(params),
    staleTime: 60_000,
  })
}
