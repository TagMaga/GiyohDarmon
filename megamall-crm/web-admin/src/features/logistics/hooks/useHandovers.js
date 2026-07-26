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

// invalidateHandoverQueries refreshes every screen backed by handover data —
// used on success AND on error: a rejection (e.g. a 409 because another
// dispatcher/owner action already changed this same handover) means the
// list behind the modal may be showing an outcome that no longer applies.
function invalidateHandoverQueries(qc, extra = []) {
  qc.invalidateQueries({ queryKey: ['logistics', 'handovers'] })
  for (const key of extra) qc.invalidateQueries({ queryKey: key })
}

export function useUpdateHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }) => updateHandover(id, body),
    onSuccess: () => invalidateHandoverQueries(qc, [['logistics', 'dashboard']]),
    onError: () => invalidateHandoverQueries(qc, [['logistics', 'dashboard']]),
  })
}

export function useDeleteHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id) => deleteHandover(id),
    onSuccess: () => invalidateHandoverQueries(qc),
    onError: () => invalidateHandoverQueries(qc),
  })
}

export function useEditHandover() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }) => editHandover(id, body),
    onSuccess: () => invalidateHandoverQueries(qc, [['logistics', 'dashboard'], ['logistics', 'couriers']]),
    onError: () => invalidateHandoverQueries(qc, [['logistics', 'dashboard'], ['logistics', 'couriers']]),
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
