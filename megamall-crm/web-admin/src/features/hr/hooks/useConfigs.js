import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchConfigs } from '../api'

export default function useConfigs(params = {}) {
  return useQuery({
    queryKey:  [...KEYS.hr.configs, params],
    queryFn:   () => fetchConfigs(params),
    staleTime: 60_000,
  })
}
