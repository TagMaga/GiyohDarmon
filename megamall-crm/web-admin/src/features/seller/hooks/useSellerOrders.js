import { useQuery }   from '@tanstack/react-query'
import { useMemo }     from 'react'
import { jwtDecode }   from 'jwt-decode'
import { KEYS }        from '../../../shared/queryKeys'
import { fetchSellerOrders } from '../api'
import useAuthStore    from '../../../shared/store/authStore'

/**
 * useSellerOrders
 *
 * Fetches all orders from GET /orders (backend should role-filter by JWT).
 * As a frontend safety measure, further filters client-side to only orders
 * whose seller_id matches the current user's ID decoded from the JWT.
 * Falls back to showing all returned orders if the user ID cannot be resolved.
 */
export default function useSellerOrders(extraParams = {}) {
  const { token } = useAuthStore()

  // Decode seller user_id from JWT
  const currentUserId = useMemo(() => {
    if (!token) return null
    try {
      const decoded = jwtDecode(token)
      return decoded.user_id ?? decoded.sub ?? decoded.id ?? null
    } catch {
      return null
    }
  }, [token])

  const query = useQuery({
    queryKey: [...KEYS.seller.orders, extraParams],
    queryFn:  () => fetchSellerOrders(extraParams),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  // Client-side safety filter
  const orders = useMemo(() => {
    const raw = Array.isArray(query.data)
      ? query.data
      : (query.data?.orders ?? query.data?.data ?? [])

    if (!currentUserId) return raw
    return raw.filter((o) => o.seller_id === currentUserId)
  }, [query.data, currentUserId])

  return { ...query, orders, currentUserId }
}
