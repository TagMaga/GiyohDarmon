import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchMyIncome } from '../api'

/**
 * useMyIncome — fetches /hr/income/me for the current authenticated user.
 *
 * @param {object} params  { from?: string, to?: string, event_type?: string, include_events?: bool }
 */
export default function useMyIncome(params = {}) {
  return useQuery({
    queryKey: KEYS.hr.incomeMe(params),
    queryFn:  () => fetchMyIncome(params),
    staleTime: 60_000,
  })
}
