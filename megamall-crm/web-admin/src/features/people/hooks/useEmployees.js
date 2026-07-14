import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchEmployees } from '../api'

export default function useEmployees(params = {}, options = {}) {
  return useQuery({
    queryKey: KEYS.people.employees(params),
    queryFn:  () => fetchEmployees(params),
    staleTime: 2 * 60_000,
    ...options,
  })
}
