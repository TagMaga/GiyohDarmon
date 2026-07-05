import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchPayeePayoutHistory } from '../../../shared/api/payoutsApi'

/**
 * usePayeePayoutHistory — payout history for one team member (TeamLeadSellerFinanceDetailPage),
 * scoped server-side to payouts the calling team lead actually made.
 */
export default function usePayeePayoutHistory(payeeId) {
  return useQuery({
    queryKey: KEYS.payouts.byPayee(payeeId),
    queryFn:  () => fetchPayeePayoutHistory(payeeId),
    staleTime: 30_000,
    enabled:  !!payeeId,
  })
}
