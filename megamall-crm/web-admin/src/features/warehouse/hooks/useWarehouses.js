import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchWarehouses } from '../api'

export default function useWarehouses() {
  return useQuery({
    queryKey:  KEYS.warehouse.warehouses,
    queryFn:   fetchWarehouses,
    staleTime: 10 * 60_000,
  })
}
