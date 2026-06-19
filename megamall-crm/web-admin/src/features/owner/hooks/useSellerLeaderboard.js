import { useQuery } from '@tanstack/react-query'
import { fetchSellerLeaderboard } from '../api'

export default function useSellerLeaderboard(params = {}) {
  return useQuery({
    queryKey: ['finance', 'sellers', params],
    queryFn:  () => fetchSellerLeaderboard(params),
    staleTime: 60_000,
  })
}
