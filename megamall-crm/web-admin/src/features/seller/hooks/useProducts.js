import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchProducts } from '../api'

function toArray(data) {
  if (Array.isArray(data))       return data
  if (Array.isArray(data?.data)) return data.data
  return []
}

export default function useProducts() {
  return useQuery({
    queryKey: KEYS.seller.products,
    queryFn:  () => fetchProducts().then(toArray),
    staleTime: 10 * 60_000,
  })
}
