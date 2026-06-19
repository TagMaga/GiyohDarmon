import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchAvailableOrders } from '../api'

export default function useAvailableOrders({ enabled = true } = {}) {
  return useQuery({
    queryKey:        KEYS.courier.available,
    queryFn:         fetchAvailableOrders,
    enabled,
    refetchInterval: 60_000,
    staleTime:       50_000,
  })
}
