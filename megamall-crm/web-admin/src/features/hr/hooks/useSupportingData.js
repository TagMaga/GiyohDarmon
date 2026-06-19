import { useQuery } from '@tanstack/react-query'
import { KEYS } from '../../../shared/queryKeys'
import { fetchTeams, fetchUsers } from '../api'

export function useTeams() {
  return useQuery({ queryKey: KEYS.hr.teams, queryFn: fetchTeams, staleTime: 10 * 60_000 })
}

export function useUsers() {
  return useQuery({ queryKey: KEYS.hr.users, queryFn: fetchUsers, staleTime: 10 * 60_000 })
}
