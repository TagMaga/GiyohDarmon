/**
 * useManagerPersonalOrders
 *
 * Fetches orders where the manager acted as the seller (personal orders).
 * Backend strategy: send seller_id=userId. If backend doesn't support this,
 * we fall back to fetching all manager orders and filtering client-side.
 *
 * Returns { items, allItems, isLoading, allLoading, isError, refetch }
 */
import { useMemo }    from 'react'
import useOwnerOrders from '../../orders/hooks/useOwnerOrders'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'

export default function useManagerPersonalOrders(pageParams = {}) {
  const { userId } = useCurrentUser()

  const serverParams = useMemo(() => ({
    ...pageParams,
    ...(userId ? { seller_id: userId } : {}),
  }), [pageParams, userId])

  const analyticsParams = useMemo(() => ({
    from:  pageParams.from,
    to:    pageParams.to,
    ...(pageParams.status ? { status: pageParams.status } : {}),
    ...(userId ? { seller_id: userId } : {}),
    limit: 500,
    page:  1,
  }), [pageParams.from, pageParams.to, pageParams.status, userId])

  const paged     = useOwnerOrders(serverParams)
  const analytics = useOwnerOrders(analyticsParams)

  // Client-side safety: keep only orders where seller_id === userId
  const safeFilter = (items) => {
    if (!userId) return items
    return items.filter(o => (o.seller_id ?? o.SellerID) === userId)
  }

  return {
    items:      safeFilter(paged.items),
    meta:       paged.meta,
    allItems:   safeFilter(analytics.items),
    isLoading:  paged.isLoading,
    allLoading: analytics.isLoading,
    isError:    paged.isError,
    error:      paged.error,
    refetch:    paged.refetch,
    isFetching: paged.isFetching,
  }
}
