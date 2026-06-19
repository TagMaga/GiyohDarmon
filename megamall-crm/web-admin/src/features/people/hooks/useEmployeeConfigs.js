import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchEmployeeConfigs } from '../api'

export default function useEmployeeConfigs(userId) {
  return useQuery({
    queryKey: KEYS.people.employeeConfigs(userId),
    queryFn:  () => fetchEmployeeConfigs(userId),
    staleTime: 2 * 60_000,
    enabled:  !!userId,
  })
}
