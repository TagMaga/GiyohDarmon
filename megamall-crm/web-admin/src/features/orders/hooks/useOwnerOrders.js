import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchOwnerOrders } from '../api'

/**
 * useOwnerOrders
 *
 * Paginated, filtered order list for the owner.
 * Returns { items, meta, isLoading, isError, error, refetch, isFetching }
 *
 * @param {object} params — { page, limit, status, team_id, seller_id, manager_id, search, from, to }
 */
export default function useOwnerOrders(params = {}) {
  const query = useQuery({
    queryKey: KEYS.orders.list(params),
    queryFn:  () => fetchOwnerOrders(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })

  return {
    ...query,
    items: query.data?.items ?? [],
    meta:  query.data?.meta  ?? null,
  }
}
