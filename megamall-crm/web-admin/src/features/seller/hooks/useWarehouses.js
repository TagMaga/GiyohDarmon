import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchWarehouses } from '../api'

export default function useWarehouses() {
  return useQuery({
    queryKey: KEYS.seller.warehouses,   // ['seller','warehouses','v2'] — busts old cache
    queryFn:  fetchWarehouses,
    staleTime: 0,
    gcTime:    5 * 60_000,
  })
}
