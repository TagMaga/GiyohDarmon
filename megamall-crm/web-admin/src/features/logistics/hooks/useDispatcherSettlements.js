import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import {
  fetchSettlementsSummary, fetchSettlements,
  confirmSettlement, rejectSettlement, fetchDispatchers,
} from '../api'

export function useDispatchers() {
  return useQuery({
    queryKey: KEYS.logistics.dispatchers,
    queryFn:  fetchDispatchers,
    staleTime: 60_000,
  })
}

export function useSettlementsSummary(params = {}) {
  return useQuery({
    queryKey: KEYS.logistics.settlementsSummary(params),
    queryFn:  () => fetchSettlementsSummary(params),
    staleTime: 30_000,
  })
}

export function useSettlements(params = {}) {
  return useQuery({
    queryKey: KEYS.logistics.settlements(params),
    queryFn:  () => fetchSettlements(params),
    staleTime: 30_000,
  })
}

export function useConfirmSettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => confirmSettlement(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistics', 'settlements'] })
    },
  })
}

export function useRejectSettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }) => rejectSettlement(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistics', 'settlements'] })
    },
  })
}
