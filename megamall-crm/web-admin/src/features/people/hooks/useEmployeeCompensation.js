import { useQuery } from '@tanstack/react-query'
import { KEYS }     from '../../../shared/queryKeys'
import { fetchEmployeeCompensation, fetchEmployeeCompensationHistory } from '../api'

export function useEmployeeCompensation(userId) {
  return useQuery({
    queryKey: KEYS.people.employeeSalary(userId),
    queryFn:  () => fetchEmployeeCompensation(userId),
    staleTime: 2 * 60_000,
    enabled:  !!userId,
  })
}

export function useEmployeeCompensationHistory(userId) {
  return useQuery({
    queryKey: KEYS.people.employeeSalaryHistory(userId),
    queryFn:  () => fetchEmployeeCompensationHistory(userId),
    staleTime: 2 * 60_000,
    enabled:  !!userId,
  })
}
