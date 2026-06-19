import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchHistory } from '../api'

export default function useHistory(params = {}) {
  return useQuery({
    queryKey:  [...KEYS.hr.history, params],
    queryFn:   () => fetchHistory(params),
    staleTime: 30_000,
  })
}
