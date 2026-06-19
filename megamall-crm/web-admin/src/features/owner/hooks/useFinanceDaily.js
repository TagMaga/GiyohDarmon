import { useQuery } from '@tanstack/react-query'
import { fetchFinanceDaily } from '../api'

export default function useFinanceDaily(params = {}) {
  return useQuery({
    queryKey: ['finance', 'daily', params],
    queryFn:  () => fetchFinanceDaily(params),
    staleTime: 60_000,
  })
}
