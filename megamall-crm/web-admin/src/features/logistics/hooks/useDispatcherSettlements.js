import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import {
  fetchSettlementsSummary, fetchSettlements,
  confirmSettlement, rejectSettlement, editSettlement, fetchSettlementHistory,
  fetchDispatchers,
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
    mutationFn: ({ id, actualReceived, adminNote }) => confirmSettlement(id, { actualReceived, adminNote }),
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

export function useEditSettlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }) => editSettlement(id, body),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['logistics', 'settlements'] })
      qc.invalidateQueries({ queryKey: KEYS.logistics.settlementHistory(id) })
    },
  })
}

export function useSettlementHistory(id, enabled = true) {
  return useQuery({
    queryKey: KEYS.logistics.settlementHistory(id),
    queryFn:  () => fetchSettlementHistory(id),
    enabled:  !!id && enabled,
    staleTime: 0,
  })
}
