import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchHandovers, createHandover, updateHandover, deleteHandover, editHandover, fetchHandoverHistory } from '../api'

export function useHandovers(params = {}) {
  return useQuery({
    queryKey: KEYS.logistics.handovers(params),
    queryFn:  () => fetchHandovers(params),
    staleTime: 30_000,
  })
}

export function useCreateHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: createHandover,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logistics', 'handovers'] }),
  })
}

export function useUpdateHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }) => updateHandover(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistics', 'handovers'] })
      qc.invalidateQueries({ queryKey: ['logistics', 'dashboard'] })
    },
  })
}

export function useDeleteHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => deleteHandover(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['logistics', 'handovers'] }),
  })
}

export function useEditHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }) => editHandover(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logistics', 'handovers'] })
      qc.invalidateQueries({ queryKey: ['logistics', 'dashboard'] })
      qc.invalidateQueries({ queryKey: ['logistics', 'couriers'] })
    },
  })
}

export function useHandoverHistory(id, enabled = true) {
  return useQuery({
    queryKey: KEYS.logistics.handoverHistory(id),
    queryFn:  () => fetchHandoverHistory(id),
    enabled:  !!id && enabled,
    staleTime: 0,
  })
}
