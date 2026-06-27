import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import {
  fetchBoard, fetchNewOrders, fetchIssueOrders,
  fetchDeliveredOrders, fetchCouriersOverview,
} from '../api'
import { buildCourierMap, getCourierId } from '../utils/orderHelpers'

const toArr = (d) => Array.isArray(d) ? d : []

export function useDispatcherBoard() {
  const qc = useQueryClient()

  const boardQ     = useQuery({ queryKey: KEYS.dispatcher.board,     queryFn: fetchBoard,            staleTime: 20_000, refetchInterval: 30_000 })
  const newQ       = useQuery({ queryKey: KEYS.dispatcher.newOrders, queryFn: fetchNewOrders,        staleTime: 20_000, refetchInterval: 30_000 })
  const issueQ     = useQuery({ queryKey: KEYS.dispatcher.issues,    queryFn: fetchIssueOrders,      staleTime: 20_000, refetchInterval: 30_000 })
  const deliveredQ = useQuery({ queryKey: KEYS.dispatcher.delivered, queryFn: fetchDeliveredOrders,  staleTime: 60_000 })
  const couriersQ  = useQuery({ queryKey: KEYS.dispatcher.couriers,  queryFn: fetchCouriersOverview, staleTime: 30_000, refetchInterval: 60_000 })

  const boardOrders     = toArr(boardQ.data)
  const newOrders       = toArr(newQ.data)
  const issueOrders     = toArr(issueQ.data)
  const deliveredOrders = toArr(deliveredQ.data)
  const courierList     = toArr(couriersQ.data)

  const allOrders = useMemo(() => [
    ...newOrders,
    ...boardOrders,
    ...issueOrders,
    ...deliveredOrders,
  ], [newOrders, boardOrders, issueOrders, deliveredOrders])

  const courierMap = useMemo(() => buildCourierMap(courierList), [courierList])

  const isLoading = boardQ.isPending || newQ.isPending

  const counts = useMemo(() => ({
    all:         allOrders.length,
    new:         newOrders.length,
    confirmed:   boardOrders.filter(o => o.status === 'confirmed').length,
    assigned:    boardOrders.filter(o => o.status === 'assigned').length,
    in_delivery: boardOrders.filter(o => o.status === 'in_delivery').length,
    issue:       issueOrders.length,
    delivered:   deliveredOrders.length,
    unassigned:  boardOrders.filter(o => o.status === 'confirmed' && !getCourierId(o)).length,
    couriers:    courierList.length,
    freeCouriers: courierList.filter(c => Number(c.active_orders ?? 0) === 0).length,
  }), [allOrders, newOrders, boardOrders, issueOrders, deliveredOrders, courierList])

  const cashOwed = useMemo(() =>
    courierList.reduce((sum, c) => sum + Number(c.cash_owed ?? 0), 0),
  [courierList])

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.board })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.newOrders })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.issues })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.delivered })
    qc.invalidateQueries({ queryKey: KEYS.dispatcher.couriers })
  }

  return { allOrders, courierList, courierMap, isLoading, invalidateAll, counts, cashOwed }
}
