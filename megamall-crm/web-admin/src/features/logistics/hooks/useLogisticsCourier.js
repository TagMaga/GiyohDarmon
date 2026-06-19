import { useQuery } from '@tanstack/react-query'
import { KEYS }    from '../../../shared/queryKeys'
import { fetchLogisticsCourier, fetchCourierOrders, fetchCourierPerformance } from '../api'

export function useLogisticsCourier(id) {
  return useQuery({
    queryKey: KEYS.logistics.courier(id),
    queryFn:  () => fetchLogisticsCourier(id),
    enabled:  !!id,
    staleTime: 30_000,
  })
}

export function useCourierOrders(id, params = {}) {
  return useQuery({
    queryKey: KEYS.logistics.courierOrders(id, params),
    queryFn:  () => fetchCourierOrders(id, params),
    enabled:  !!id,
    staleTime: 30_000,
  })
}

export function useCourierPerformance(id, params = {}) {
  return useQuery({
    queryKey: KEYS.logistics.performance(id, params),
    queryFn:  () => fetchCourierPerformance(id, params),
    enabled:  !!id,
    staleTime: 60_000,
  })
}
