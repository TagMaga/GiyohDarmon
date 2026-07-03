import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../queryKeys'
import { fetchMyPayouts } from '../api/payoutsApi'

/**
 * useMyPayouts — payouts received by the current user.
 * Shared across Seller and Manager "Выплаты" tabs — same endpoint, same shape,
 * just naturally scoped server-side to whoever the JWT belongs to.
 */
export default function useMyPayouts() {
  return useQuery({
    queryKey: KEYS.payouts.me,
    queryFn:  fetchMyPayouts,
    staleTime: 60_000,
  })
}
