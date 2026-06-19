import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchInventory } from '../api'

export default function useInventory(params = {}, options = {}) {
  return useQuery({
    queryKey:  [...KEYS.warehouse.inventory, params],
    queryFn:   () => fetchInventory(params),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  })
}
