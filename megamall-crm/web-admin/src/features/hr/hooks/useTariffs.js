import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchActiveTariff, fetchTariffs } from '../api'

export function useActiveTariff() {
  return useQuery({ queryKey: KEYS.hr.tariffActive, queryFn: fetchActiveTariff, staleTime: 5 * 60_000 })
}

export function useTariffs() {
  return useQuery({ queryKey: KEYS.hr.tariffs, queryFn: fetchTariffs, staleTime: 5 * 60_000 })
}
