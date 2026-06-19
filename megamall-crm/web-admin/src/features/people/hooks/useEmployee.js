import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchEmployee } from '../api'

const isUUID = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export default function useEmployee(userId) {
  return useQuery({
    queryKey: KEYS.people.employee(userId),
    queryFn:  () => fetchEmployee(userId),
    staleTime: 5 * 60_000,
    enabled:  isUUID(userId),
  })
}
