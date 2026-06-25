import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchMyPayouts } from '../api'

export default function useSellerPayouts() {
  return useQuery({
    queryKey: KEYS.seller.payouts,
    queryFn:  fetchMyPayouts,
    staleTime: 2 * 60 * 1000,
  })
}
