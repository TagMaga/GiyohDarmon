import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import {
  acceptReturn,
  createTransfer,
  createWarehouse,
  decideLostReport,
  fetchInventoryDistribution,
  fetchInventorySummary,
  fetchLostReports,
  fetchReturns,
  fetchTransfers,
  fetchWarehouses,
  rejectReturn,
} from '../api'

export function useInventorySummary(options = {}) {
  return useQuery({
    queryKey: KEYS.warehouse.inventorySummary,
    queryFn: fetchInventorySummary,
    staleTime: 15_000,
    enabled: options.enabled ?? true,
  })
}

export function useInventoryDistribution(options = {}) {
  return useQuery({
    queryKey: KEYS.warehouse.inventoryDistribution,
    queryFn: fetchInventoryDistribution,
    staleTime: 15_000,
    enabled: options.enabled ?? true,
  })
}

export function useWarehouses(options = {}) {
  return useQuery({
    queryKey: KEYS.warehouse.warehouses,
    queryFn: () => fetchWarehouses(),
    staleTime: 60_000,
    enabled: options.enabled ?? true,
  })
}

export function useCreateWarehouse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createWarehouse,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEYS.warehouse.warehouses }),
  })
}

export function useTransfers(params = {}, options = {}) {
  return useQuery({
    queryKey: KEYS.warehouse.transfers(params),
    queryFn: () => fetchTransfers(params),
    staleTime: 15_000,
    enabled: options.enabled ?? true,
  })
}

export function useCreateTransfer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createTransfer,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse', 'transfers'] })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventorySummary })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventoryDistribution })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.movements })
    },
  })
}

export function useLostReports(params = {}, options = {}) {
  return useQuery({
    queryKey: KEYS.warehouse.lostReports(params),
    queryFn: () => fetchLostReports(params),
    staleTime: 15_000,
    enabled: options.enabled ?? true,
  })
}

export function useDecideLostReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ reportId, payload }) => decideLostReport(reportId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse', 'lostReports'] })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventorySummary })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventoryDistribution })
    },
  })
}

export function useReturns(params = {}, options = {}) {
  return useQuery({
    queryKey: KEYS.warehouse.returns(params),
    queryFn: () => fetchReturns(params),
    staleTime: 15_000,
    enabled: options.enabled ?? true,
  })
}

export function useAcceptReturn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: acceptReturn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouse', 'returns'] })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventorySummary })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.inventoryDistribution })
      qc.invalidateQueries({ queryKey: KEYS.warehouse.movements })
    },
  })
}

export function useRejectReturn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: rejectReturn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouse', 'returns'] }),
  })
}
