/**
 * useTeamLeadOrders
 *
 * Fetches orders for the team lead's own team.
 * Passes team_lead_id + optional team_id so the backend can filter by either.
 * Client-side safety: filters to orders where seller_id is a team member.
 *
 * Returns { items, meta, allItems, isLoading, isError, refetch, isFetching }
 *   items    — current page
 *   allItems — full period (large limit) for KPI + analytics
 */
import { useMemo }        from 'react'
import useOwnerOrders     from '../../orders/hooks/useOwnerOrders'
import useCurrentUser     from '../../../shared/hooks/useCurrentUser'
import useMyTeam          from './useMyTeam'

/**
 * @param {object} pageParams   — { page, limit, status, seller_id, search, from, to }
 * @param {string[]} memberIds  — list of user IDs that are members of this team (for safety filter)
 */
export default function useTeamLeadOrders(pageParams = {}, memberIds = []) {
  const { userId }  = useCurrentUser()
  const { teamId }  = useMyTeam()

  // Build server params — pass team_lead_id so backend knows who's asking
  const serverParams = useMemo(() => ({
    ...pageParams,
    ...(userId ? { team_lead_id: userId } : {}),
    ...(teamId ? { team_id: teamId }      : {}),
  }), [pageParams, userId, teamId])

  // Analytics (large limit, no pagination)
  const analyticsParams = useMemo(() => ({
    from:  pageParams.from,
    to:    pageParams.to,
    ...(pageParams.status    ? { status:    pageParams.status }    : {}),
    ...(pageParams.seller_id ? { seller_id: pageParams.seller_id } : {}),
    ...(pageParams.search    ? { search:    pageParams.search }    : {}),
    ...(userId ? { team_lead_id: userId } : {}),
    ...(teamId ? { team_id: teamId }      : {}),
    limit: 500,
    page:  1,
  }), [pageParams.from, pageParams.to, pageParams.status, pageParams.seller_id, pageParams.search, userId, teamId])

  const paged     = useOwnerOrders(serverParams)
  const analytics = useOwnerOrders(analyticsParams)

  // Client-side safety filter: only show orders where seller_id belongs to team
  const filterToTeam = (items) => {
    if (!memberIds.length) return items
    return items.filter(o => {
      const sid = o.seller_id ?? o.SellerID
      return !sid || memberIds.includes(sid)
    })
  }

  return {
    items:     filterToTeam(paged.items),
    meta:      paged.meta,
    allItems:  filterToTeam(analytics.items),
    isLoading: paged.isLoading,
    isError:   paged.isError,
    error:     paged.error,
    refetch:   paged.refetch,
    isFetching: paged.isFetching,
    allLoading: analytics.isLoading,
  }
}
