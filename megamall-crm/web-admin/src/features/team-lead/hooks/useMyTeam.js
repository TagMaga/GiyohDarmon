/**
 * useMyTeam
 *
 * Resolves the team that the current team lead manages.
 * Strategy: fetch all teams, find the one where team_lead_id === currentUserId.
 *
 * Returns { team, teamId, isLoading, isError }
 */
import { useMemo }      from 'react'
import useTeams         from '../../people/hooks/useTeams'
import useCurrentUser   from '../../../shared/hooks/useCurrentUser'

export default function useMyTeam() {
  const { userId } = useCurrentUser()
  const { data: teams = [], isLoading, isError } = useTeams()

  const team = useMemo(() => {
    if (!userId || !teams.length) return null
    return teams.find(t => t.team_lead_id === userId) ?? null
  }, [teams, userId])

  return { team, teamId: team?.id ?? null, isLoading, isError }
}
