import { useQuery } from '@tanstack/react-query'
import { fetchBudgetSummary } from '../api'

export const BUDGET_SUMMARY_KEY = (params) => ['budget', 'summary', params ?? {}]

export default function useBudgetSummary(params = {}) {
  return useQuery({
    queryKey: BUDGET_SUMMARY_KEY(params),
    queryFn:  () => fetchBudgetSummary(params),
    staleTime: 30_000,
  })
}
