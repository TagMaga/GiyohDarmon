import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchUserChain } from '../api'

export default function useEmployeeHierarchy(userId) {
  return useQuery({
    queryKey: KEYS.people.userChain(userId),
    queryFn:  () => fetchUserChain(userId),
    staleTime: 5 * 60_000,
    enabled:  !!userId,
  })
}
