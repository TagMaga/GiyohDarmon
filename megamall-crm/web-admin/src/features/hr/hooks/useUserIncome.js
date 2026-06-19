import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchUserIncome } from '../api'

/**
 * useUserIncome — fetches /hr/income/users/:userId (RBAC enforced by backend).
 *
 * @param {string} userId
 * @param {object} params  { from?, to?, event_type?, include_events? }
 */
export default function useUserIncome(userId, params = {}) {
  return useQuery({
    queryKey: KEYS.hr.incomeUser(userId, params),
    queryFn:  () => fetchUserIncome(userId, params),
    staleTime: 60_000,
    enabled:  !!userId,
  })
}
