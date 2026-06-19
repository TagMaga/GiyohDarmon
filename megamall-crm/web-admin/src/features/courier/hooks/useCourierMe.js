import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchCourierMe } from '../api'

export default function useCourierMe() {
  return useQuery({
    queryKey: KEYS.courier.me,
    queryFn: fetchCourierMe,
    staleTime: 30_000,
  })
}
