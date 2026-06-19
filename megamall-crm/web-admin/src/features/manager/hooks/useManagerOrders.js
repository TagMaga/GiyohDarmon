/**
 * useManagerOrders
 *
 * Paginated team orders scoped to this manager.
 * Sends manager_id + team_id to backend; also safety-filters client-side
 * to seller IDs from the manager's own team.
 *
 * Returns { items, meta, allItems, isLoading, allLoading, isError, error, refetch, isFetching }
 */
import { useMemo }        from 'react'
import useOwnerOrders     from '../../orders/hooks/useOwnerOrders'
import useCurrentUser     from '../../../shared/hooks/useCurrentUser'
import useMyManagerTeam   from './useMyManagerTeam'

export default function useManagerOrders(pageParams = {}, memberIds = []) {
  const { userId } = useCurrentUser()
  const { teamId } = useMyManagerTeam()

  const serverParams = useMemo(() => ({
    ...pageParams,
    ...(userId ? { manager_id: userId } : {}),
    ...(teamId ? { team_id:    teamId } : {}),
  }), [pageParams, userId, teamId])

  const analyticsParams = useMemo(() => ({
    from:  pageParams.from,
    to:    pageParams.to,
    ...(pageParams.status    ? { status:    pageParams.status }    : {}),
    ...(pageParams.seller_id ? { seller_id: pageParams.seller_id } : {}),
    ...(pageParams.search    ? { search:    pageParams.search }    : {}),
    ...(userId ? { manager_id: userId } : {}),
    ...(teamId ? { team_id:    teamId } : {}),
    limit: 500,
    page:  1,
  }), [pageParams.from, pageParams.to, pageParams.status, pageParams.seller_id, pageParams.search, userId, teamId])

  const paged     = useOwnerOrders(serverParams)
  const analytics = useOwnerOrders(analyticsParams)

  const safeFilter = (items) => {
    if (!memberIds.length) return items
    return items.filter(o => {
      const sid = o.seller_id ?? o.SellerID
      return !sid || memberIds.includes(sid)
    })
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
