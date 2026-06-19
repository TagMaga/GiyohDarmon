/**
 * useMyManagerTeam
 *
 * Resolves the team this manager is assigned to.
 * Strategy: fetch all teams, find one where manager_id === currentUserId.
 *
 * Returns { team, teamId, isLoading, isError }
 */
import { useMemo }    from 'react'
import useTeams       from '../../people/hooks/useTeams'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'

export default function useMyManagerTeam() {
  const { userId } = useCurrentUser()
  const { data: teams = [], isLoading, isError } = useTeams()

  const team = useMemo(() => {
    if (!userId || !teams.length) return null
    return teams.find(t => t.manager_id === userId) ?? null
  }, [teams, userId])

  return { team, teamId: team?.id ?? null, isLoading, isError }
}
