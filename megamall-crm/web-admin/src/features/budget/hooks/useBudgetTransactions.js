import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { fetchBudgetTransactions } from '../api'

export const BUDGET_TX_KEY = (params) => ['budget', 'transactions', params ?? {}]

export default function useBudgetTransactions(params = {}) {
  return useQuery({
    queryKey:        BUDGET_TX_KEY(params),
    queryFn:         () => fetchBudgetTransactions(params),
    staleTime:       30_000,
    placeholderData: keepPreviousData,
  })
}
