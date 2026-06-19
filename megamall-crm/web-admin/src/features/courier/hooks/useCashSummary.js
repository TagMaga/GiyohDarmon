import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchCashSummary } from '../api'

export default function useCashSummary({ enabled = true } = {}) {
  return useQuery({
    queryKey:  KEYS.courier.cashSummary,
    queryFn:   fetchCashSummary,
    enabled,
    staleTime: 0,
  })
}
