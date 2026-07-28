import { useQuery } from '@tanstack/react-query'
import { fetchBudgetWithdrawalRequests } from '../api'

export const BUDGET_WITHDRAWAL_REQUESTS_KEY = ['budget', 'withdrawal-requests']

export default function useBudgetWithdrawalRequests() {
  return useQuery({
    queryKey: BUDGET_WITHDRAWAL_REQUESTS_KEY,
    queryFn: fetchBudgetWithdrawalRequests,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}
