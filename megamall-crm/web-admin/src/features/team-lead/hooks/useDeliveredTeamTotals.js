import { useMemo } from 'react'
import { useQuery }    from '@tanstack/react-query'
import { fetchOwnerOrders } from '../../orders/api'
import { KEYS }        from '../../../shared/queryKeys'
import useCurrentUser  from '../../../shared/hooks/useCurrentUser'
import useMyTeam       from './useMyTeam'

// Server clamps any requested limit to pkg/pagination.MaxLimit (100) —
// requesting more per page than that would silently be capped anyway, so
// we page at the server's actual ceiling and keep fetching until meta says
// there's nothing left, instead of trusting a single large `limit` to
// return everything in one shot.
const PAGE_LIMIT = 100

/**
 * fetchAllDelivered — pages through GET /orders?status=delivered until every
 * row for the period has been collected. A single request capped at
 * PAGE_LIMIT would silently truncate any team with more than 100 delivered
 * orders in the selected period; this loop keeps requesting subsequent
 * pages while meta reports more remain.
 */
async function fetchAllDelivered(baseParams) {
  const all = []
  let page = 1
  // Safety bound: 200 pages × 100/page = 20,000 orders — far beyond any
  // realistic single-team-lead period, just guarding against an infinite
  // loop if the backend ever reports total_pages incorrectly.
  const MAX_PAGES = 200
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
 * useDeliveredTeamTotals — per-member gross revenue / order count / courier
 * fee totals computed from *delivered* orders only, keyed by user id.
 *
 * usePayables()'s gross_amount/orders_count count every order regardless of
 * status (backend team-order-gross-totals query has no status filter), which
 * makes the Финансы screens show "6130 с · 14 заказов" for a seller whose
 * orders were mostly never delivered. Real earnings (payables.earned) are
 * unaffected — financial_events only ever get written on delivery — so only
 * the *gross* figures shown alongside them need recomputing here, from the
 * same delivered-only universe the money actually comes from.
 *
 * commission_base (see internal/orders/financial.go) = total_order_amount −
 * courier_payout, so callers wanting a real percentage should net
 * courierFeeTotal out of grossAmount before dividing into `earned`.
 *
 * @param {object} params { from, to }
 * @returns {{ byUser: Record<string,{ordersCount:number, grossAmount:number, courierFeeTotal:number}>, isLoading: boolean }}
 */
export default function useDeliveredTeamTotals(params = {}) {
  const { userId } = useCurrentUser()
  const { teamId }  = useMyTeam()

  const baseParams = useMemo(() => ({
    ...params,
    status: 'delivered',
    ...(userId ? { team_lead_id: userId } : {}),
    ...(teamId ? { team_id: teamId }      : {}),
  }), [params, userId, teamId])

  const { data: items = [], isLoading } = useQuery({
    queryKey: [...KEYS.orders.list(baseParams), 'all-pages'],
    queryFn:  () => fetchAllDelivered(baseParams),
    staleTime: 30_000,
    enabled: !!userId,
  })

  const byUser = useMemo(() => {
    const out = {}
    const bump = (id, amount, courierFee) => {
      if (!id) return
      if (!out[id]) out[id] = { ordersCount: 0, grossAmount: 0, courierFeeTotal: 0 }
      out[id].ordersCount += 1
      out[id].grossAmount += amount
      out[id].courierFeeTotal += courierFee
    }
    items.forEach(o => {
      const amount     = Number(o.total_order_amount ?? (Number(o.total_amount ?? 0) + Number(o.delivery_fee ?? 0)))
      const courierFee = Number(o.courier_payout ?? 0)
      const sellerId  = o.seller_id  ?? o.SellerID
      const managerId = o.manager_id ?? o.ManagerID
      bump(sellerId, amount, courierFee)
      if (managerId && managerId !== sellerId) bump(managerId, amount, courierFee)
    })
    return out
  }, [items])

  return { byUser, isLoading }
}
