import { useQuery } from '@tanstack/react-query'
import { KEYS }    from '../../../shared/queryKeys'
import { fetchLogisticsDashboard } from '../api'

export default function useLogisticsDashboard() {
  return useQuery({
    queryKey: KEYS.logistics.dashboard,
    queryFn:  fetchLogisticsDashboard,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}
