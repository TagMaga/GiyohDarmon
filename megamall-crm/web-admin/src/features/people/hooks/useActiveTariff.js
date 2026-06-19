import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchActiveTariff } from '../api'

export default function useActiveTariff() {
  return useQuery({
    queryKey: KEYS.people.activeTariff,
    queryFn:  fetchActiveTariff,
    staleTime: 10 * 60_000,
  })
}
