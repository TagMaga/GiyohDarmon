import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchInventory } from '../api'

/**
 * useInventory — fetches stock for a specific product.
 * Enabled only when the product ID is present. Never blocks order submit on failure.
 */
export default function useInventory(productId) {
  return useQuery({
    queryKey: KEYS.seller.inventory(productId),
    queryFn:  () => fetchInventory(productId),
    enabled:  !!productId,
    staleTime: 2 * 60_000,
    retry:    false, // stock is optional hint; don't hammer on 404
  })
}
