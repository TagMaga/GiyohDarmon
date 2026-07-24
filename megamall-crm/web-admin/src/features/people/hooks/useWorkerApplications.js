import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchWorkerApplications } from '../api'

export default function useWorkerApplications(status = 'pending', options = {}) {
  return useQuery({
    queryKey: KEYS.people.workerApplications(status),
    queryFn:  () => fetchWorkerApplications(status),
    staleTime: 60_000,
    ...options,
  })
}
