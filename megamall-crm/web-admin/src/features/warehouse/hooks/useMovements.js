import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchMovements } from '../api'

export default function useMovements(params = {}, options = {}) {
  return useQuery({
    queryKey:  [...KEYS.warehouse.movements, params],
    queryFn:   () => fetchMovements(params),
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  })
}
