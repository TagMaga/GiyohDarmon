import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchTeamConfigs } from '../api'

export default function useTeamConfigs(teamId) {
  return useQuery({
    queryKey: KEYS.people.teamConfigs(teamId),
    queryFn:  () => fetchTeamConfigs(teamId),
    staleTime: 2 * 60_000,
    enabled:  !!teamId,
  })
}
