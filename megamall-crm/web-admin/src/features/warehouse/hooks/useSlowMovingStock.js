import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchSlowMovingStock } from '../api'

export default function useSlowMovingStock(params = {}, options = {}) {
  return useQuery({
    queryKey: KEYS.warehouse.slowMoving(params),
    queryFn: () => fetchSlowMovingStock(params),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  })
}
