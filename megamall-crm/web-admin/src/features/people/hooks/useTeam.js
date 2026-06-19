import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchTeam } from '../api'

export default function useTeam(teamId) {
  return useQuery({
    queryKey: KEYS.people.team(teamId),
    queryFn:  () => fetchTeam(teamId),
    staleTime: 5 * 60_000,
    enabled:  !!teamId,
  })
}
