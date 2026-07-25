import { useMemo } from 'react'
import useOwnerOrders  from '../../orders/hooks/useOwnerOrders'
import useCurrentUser  from '../../../shared/hooks/useCurrentUser'
import useMyTeam       from './useMyTeam'

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

  const queryParams = useMemo(() => ({
    ...params,
    status: 'delivered',
    ...(userId ? { team_lead_id: userId } : {}),
    ...(teamId ? { team_id: teamId }      : {}),
    limit: 500,
    page: 1,
  }), [params, userId, teamId])

  const { items, isLoading } = useOwnerOrders(queryParams)

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
