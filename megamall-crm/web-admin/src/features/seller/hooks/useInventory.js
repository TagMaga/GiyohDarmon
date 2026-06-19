import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchInventory } from '../api'

/**
 * useInventory — fetches stock for a specific product + warehouse combo.
 * Enabled only when both IDs are present. Never blocks order submit on failure.
 */
export default function useInventory(productId, warehouseId) {
  return useQuery({
    queryKey: KEYS.seller.inventory(productId, warehouseId),
    queryFn:  () => fetchInventory(productId, warehouseId),
    enabled:  !!productId && !!warehouseId,
    staleTime: 2 * 60_000,
    retry:    false, // stock is optional hint; don't hammer on 404
  })
}
