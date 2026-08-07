import { useMemo } from 'react'
import { useQuery }    from '@tanstack/react-query'
import { fetchOwnerOrders } from '../../orders/api'
import { KEYS }        from '../../../shared/queryKeys'
import useCurrentUser  from '../../../shared/hooks/useCurrentUser'
import useMyTeam       from './useMyTeam'

// See useDeliveredTeamTotals.js for why we page at the server's real ceiling
// instead of trusting a single large `limit`.
const PAGE_LIMIT = 100
const MAX_PAGES = 200

async function fetchAllPages(baseParams) {
  const all = []
  let page = 1
  while (page <= MAX_PAGES) {
    const { items, meta } = await fetchOwnerOrders({ ...baseParams, page, limit: PAGE_LIMIT })
    all.push(...items)
    const totalPages = meta?.total_pages ?? (items.length < PAGE_LIMIT ? page : page + 1)
    if (page >= totalPages || items.length < PAGE_LIMIT) break
    page += 1
  }
  return all
}

/**
 * useTeamOrderTotals — status-agnostic sibling of useDeliveredTeamTotals: pages
 * through *every* order (any status) for the team lead's team in a date+seller
 * window, so the mobile totals card / status breakdown strip stay accurate
 * regardless of which status chip is active.
 *
 * Search is applied client-side, matching order number OR comment (`notes`) —
 * the backend's order search indexes order_number/customer/seller but not
 * notes, so it can't be pushed down as a query param.
 *
 * @param {object} params { from, to, sellerId, search }
 * @returns {{ scoped: object[], byStatus: Record<string,{count:number, amount:number}>, total: {count:number, amount:number}, isLoading: boolean }}
 */
export default function useTeamOrderTotals(params = {}) {
  const { userId } = useCurrentUser()
  const { teamId }  = useMyTeam()
  const { from, to, sellerId, search } = params

  const baseParams = useMemo(() => ({
    from, to,
    ...(sellerId ? { seller_id: sellerId } : {}),
    ...(userId ? { team_lead_id: userId } : {}),
    ...(teamId ? { team_id: teamId }      : {}),
  }), [from, to, sellerId, userId, teamId])

  const { data: items = [], isLoading } = useQuery({
    queryKey: [...KEYS.orders.list(baseParams), 'team-totals-all-pages'],
    queryFn:  () => fetchAllPages(baseParams),
    staleTime: 30_000,
    enabled: !!userId,
  })

  const scoped = useMemo(() => {
    const q = (search ?? '').trim().toLowerCase()
    if (!q) return items
    return items.filter(o =>
      (o.order_number ?? '').toLowerCase().includes(q) ||
      (o.notes ?? '').toLowerCase().includes(q)
    )
  }, [items, search])

  const byStatus = useMemo(() => {
    const out = {}
    scoped.forEach(o => {
      const status = o.status ?? ''
      const amount = Number(o.total_order_amount ?? o.total_amount ?? 0)
      if (!out[status]) out[status] = { count: 0, amount: 0 }
      out[status].count += 1
      out[status].amount += amount
    })
    return out
  }, [scoped])

  const total = useMemo(() => ({
    count:  scoped.length,
    amount: scoped.reduce((sum, o) => sum + Number(o.total_order_amount ?? o.total_amount ?? 0), 0),
  }), [scoped])

  return { scoped, byStatus, total, isLoading }
}
