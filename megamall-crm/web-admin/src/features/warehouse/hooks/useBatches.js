import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchBatches } from '../api'

export default function useBatches(params = {}, options = {}) {
  return useQuery({
    queryKey: [...KEYS.warehouse.batches(params.product_id), params],
    queryFn: () => fetchBatches(params),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  })
}
