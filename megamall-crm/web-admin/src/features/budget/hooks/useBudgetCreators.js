import { useQuery } from '@tanstack/react-query'
import { fetchBudgetCreators } from '../api'

export const BUDGET_CREATORS_KEY = ['budget', 'creators']

export default function useBudgetCreators() {
  return useQuery({
    queryKey: BUDGET_CREATORS_KEY,
    queryFn:  fetchBudgetCreators,
    staleTime: 60_000,
  })
}
