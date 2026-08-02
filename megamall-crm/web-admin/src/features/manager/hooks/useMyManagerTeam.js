/**
 * useMyManagerTeam
 *
 * Resolves the team(s) this manager is assigned to. A manager can be
 * assigned as manager_id on more than one team (no uniqueness constraint
 * in the schema), so this resolves ALL of them, not just one.
 *
 * `team`/`teamId` (singular) are kept for pages that only ever show a
 * single "my team" profile — they point at the most recently created team.
 * `teams`/`teamIds` (plural) are for pages that must show every seller/
 * order the manager is responsible for — use these for sellers/orders
 * listings so nothing from a second managed team goes missing.
 *
 * Returns { team, teamId, teams, teamIds, isLoading, isError }
 */
import { useMemo }    from 'react'
import useTeams       from '../../people/hooks/useTeams'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'

export default function useMyManagerTeam() {
  const { userId } = useCurrentUser()
  const { data: teams = [], isLoading, isError } = useTeams()

  const myTeams = useMemo(() => {
    if (!userId || !teams.length) return []
    return teams.filter(t => t.manager_id === userId)
  }, [teams, userId])

  const team = myTeams[0] ?? null
  const teamIds = useMemo(() => myTeams.map(t => t.id), [myTeams])

  return { team, teamId: team?.id ?? null, teams: myTeams, teamIds, isLoading, isError }
}
