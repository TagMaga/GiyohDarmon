import { useMutation, useQueryClient } from '@tanstack/react-query'
import { voidPayout } from '../api/payoutsApi'

/**
 * useVoidPayout — reverses a payout (owner or the original payer only,
 * enforced server-side). Invalidates the Finance ledger and payables queries
 * so the void is reflected immediately: the ledger row disappears (voided
 * payouts are excluded from ListFinancialEvents) and the payee's "remaining"
 * goes back up (SumPaidGroupedByPayee excludes voided rows too).
 */
export default function useVoidPayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }) => voidPayout(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['finance', 'events'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
    },
  })
}
