import { useQueries } from '@tanstack/react-query'
import { useMemo }    from 'react'
import { KEYS }       from '../../../shared/queryKeys'
import { fetchTeamMembers } from '../api'

/**
 * useTeamMembersForTeams
 *
 * Like useTeamMembers, but for a manager/lead responsible for more than one
 * team: fetches each team's roster in parallel and flattens the result into
 * one deduplicated member list. A manager with a single team behaves
 * identically to useTeamMembers(teamId).
 *
 * Returns { data, isLoading, isError }
 */
export default function useTeamMembersForTeams(teamIds = []) {
  const results = useQueries({
    queries: teamIds.map((teamId) => ({
      queryKey:  KEYS.people.teamMembers(teamId),
      queryFn:   () => fetchTeamMembers(teamId),
      staleTime: 5 * 60_000,
      enabled:   !!teamId,
    })),
  })

  const data = useMemo(() => {
    const seen = new Set()
    const merged = []
    for (const r of results) {
      for (const m of r.data ?? []) {
        if (seen.has(m.user_id)) continue
        seen.add(m.user_id)
        merged.push(m)
      }
    }
    return merged
  }, [results])

  return {
    data,
    isLoading: results.some(r => r.isLoading),
    isError:   results.some(r => r.isError),
  }
}
