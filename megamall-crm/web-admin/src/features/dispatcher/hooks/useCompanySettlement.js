import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchMySettlementsSummary, fetchMySettlements, submitSettlement } from '../api'

export function useMySettlementsSummary(params = {}) {
  return useQuery({
    queryKey: KEYS.dispatcher.settlementsSummary(params),
    queryFn:  () => fetchMySettlementsSummary(params),
    staleTime: 30_000,
  })
}

export function useMySettlements(params = {}) {
  return useQuery({
    queryKey: KEYS.dispatcher.settlements(params),
    queryFn:  () => fetchMySettlements(params),
    staleTime: 30_000,
  })
}

export function useSubmitSettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (comment) => submitSettlement(comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatcher', 'settlements'] })
    },
  })
}
