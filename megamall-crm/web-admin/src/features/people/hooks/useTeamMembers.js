import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchTeamMembers } from '../api'

export default function useTeamMembers(teamId) {
  return useQuery({
    queryKey: KEYS.people.teamMembers(teamId),
    queryFn:  () => fetchTeamMembers(teamId),
    staleTime: 5 * 60_000,
    enabled:  !!teamId,
  })
}
