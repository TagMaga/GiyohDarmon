import { useQuery } from '@tanstack/react-query'
import { fetchTeamPerformance } from '../api'

export default function useTeamPerformance(params = {}) {
  return useQuery({
    queryKey: ['finance', 'teams', params],
    queryFn:  () => fetchTeamPerformance(params),
    staleTime: 60_000,
  })
}
