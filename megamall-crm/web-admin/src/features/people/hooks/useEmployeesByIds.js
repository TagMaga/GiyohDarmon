import { useQuery } from '@tanstack/react-query'
import { useMemo }  from 'react'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchEmployeesBatch } from '../api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const normalizeIds = (ids = []) =>
  [...new Set(ids.filter(id => typeof id === 'string' && UUID_RE.test(id)))]

export default function useEmployeesByIds(ids = []) {
  const employeeIds = useMemo(() => normalizeIds(ids), [ids])

  return useQuery({
    queryKey:  [...KEYS.people.employees(), { ids: employeeIds }],
    queryFn:   () => fetchEmployeesBatch(employeeIds),
    enabled:   employeeIds.length > 0,
    staleTime: 5 * 60_000,
    select:    (data) => data ?? [],
  })
}
