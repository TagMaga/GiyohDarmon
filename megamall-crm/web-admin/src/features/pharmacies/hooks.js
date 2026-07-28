import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KEYS } from '../../shared/queryKeys'
import * as api from './api'

export function usePharmacies(params = {}) {
  return useQuery({ queryKey: KEYS.pharmacies.list(params), queryFn: () => api.fetchPharmacies(params) })
}
export function usePharmacyDashboard(params = {}) {
  return useQuery({ queryKey: KEYS.pharmacies.dashboard(params), queryFn: () => api.fetchPharmacyDashboard(params) })
}

export function usePharmacy(id) {
  return useQuery({ queryKey: KEYS.pharmacies.detail(id), queryFn: () => api.fetchPharmacy(id), enabled: Boolean(id) })
}

export function usePharmacyMutation(mutationFn, detailId) {
  const client = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['pharmacies'] })
      if (detailId) client.invalidateQueries({ queryKey: KEYS.pharmacies.detail(detailId) })
      client.invalidateQueries({ queryKey: KEYS.warehouse.inventory })
      client.invalidateQueries({ queryKey: ['income'] })
    },
  })
}
