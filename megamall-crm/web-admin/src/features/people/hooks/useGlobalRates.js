import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchGlobalRates } from '../api'

export default function useGlobalRates() {
  return useQuery({
    queryKey: KEYS.people.globalRates,
    queryFn:  fetchGlobalRates,
    staleTime: 5 * 60_000,
  })
}
