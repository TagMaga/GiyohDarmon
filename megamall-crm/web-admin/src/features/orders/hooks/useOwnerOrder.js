import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchOwnerOrder, fetchOrderFinanceEvents } from '../api'

/**
 * useOwnerOrder — single order detail + its finance events.
 * Only fires when orderId is truthy (used by OrderDetailsDrawer).
 */
export function useOwnerOrder(orderId) {
  return useQuery({
    queryKey: KEYS.orders.detail(orderId),
    queryFn:  () => fetchOwnerOrder(orderId),
    enabled:  !!orderId,
    staleTime: 60_000,
  })
}

export function useOrderFinanceEvents(orderId) {
  return useQuery({
    queryKey: KEYS.orders.events(orderId),
    queryFn:  () => fetchOrderFinanceEvents(orderId),
    enabled:  !!orderId,
    staleTime: 60_000,
  })
}
