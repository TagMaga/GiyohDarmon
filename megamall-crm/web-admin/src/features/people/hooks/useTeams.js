import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchTeams } from '../api'

export default function useTeams(params = {}, options = {}) {
  return useQuery({
    queryKey: KEYS.people.teams(params),
    queryFn:  () => fetchTeams(params),
    staleTime: 5 * 60_000,
    ...options,
  })
}
