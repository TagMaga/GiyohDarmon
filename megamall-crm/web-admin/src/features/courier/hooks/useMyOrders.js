import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchMyOrders } from '../api'

export default function useMyOrders() {
  return useQuery({
    queryKey:        KEYS.courier.myOrders,
    queryFn:         fetchMyOrders,
    refetchInterval: 30_000,
    staleTime:       20_000,
  })
}
