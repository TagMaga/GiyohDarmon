import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchProducts } from '../api'

export default function useProducts() {
  return useQuery({
    queryKey:  KEYS.warehouse.products,
    queryFn:   fetchProducts,
    staleTime: 5 * 60_000,
  })
}
