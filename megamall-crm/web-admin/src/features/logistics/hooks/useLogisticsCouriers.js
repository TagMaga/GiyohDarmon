import { useQuery } from '@tanstack/react-query'
import { KEYS }    from '../../../shared/queryKeys'
import { fetchLogisticsCouriers } from '../api'

export default function useLogisticsCouriers() {
  return useQuery({
    queryKey: KEYS.logistics.couriers,
    queryFn:  fetchLogisticsCouriers,
    staleTime: 60_000,
  })
}
