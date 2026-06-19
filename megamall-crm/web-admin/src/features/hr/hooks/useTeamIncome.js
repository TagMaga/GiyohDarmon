import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchTeamIncome } from '../api'

/**
 * useTeamIncome — fetches /hr/income/teams/:teamLeadId.
 * teamLeadId is the user_id of the team lead (not a teams table PK).
 *
 * @param {string} teamLeadId
 * @param {object} params  { from?, to? }
 */
export default function useTeamIncome(teamLeadId, params = {}) {
  return useQuery({
    queryKey: KEYS.hr.incomeTeam(teamLeadId, params),
    queryFn:  () => fetchTeamIncome(teamLeadId, params),
    staleTime: 60_000,
    enabled:  !!teamLeadId,
  })
}
