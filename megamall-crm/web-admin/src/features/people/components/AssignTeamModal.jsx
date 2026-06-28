import { useState, useEffect } from 'react'
import { useMutation, useQueryClient }  from '@tanstack/react-query'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS }     from '../../../shared/queryKeys'
import { assignHierarchy, updateTeam } from '../api'

export default function AssignTeamModal({ open, onClose, user, teams = [], current = null }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [teamId, setTeamId] = useState(current?.team_id ?? '')
  const role = user?.role ?? user?.Role ?? ''

  useEffect(() => {
    if (open) setTeamId(current?.team_id ?? '')
  }, [open, user?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      await assignHierarchy({
        user_id: user.id,
        team_id: teamId || undefined,
      })

      // Keep team.manager_id / team.team_lead_id in sync
      if (teamId) {
        if (role === 'manager') {
          await updateTeam(teamId, { manager_id: user.id })
        } else if (role === 'sales_team_lead' || role === 'team_lead') {
          await updateTeam(teamId, { team_lead_id: user.id })
        }
      }
    },
    onSuccess: () => {
      // Invalidate everything that could show stale data
      qc.invalidateQueries({ queryKey: KEYS.people.userChain(user.id) })
      qc.invalidateQueries({ queryKey: KEYS.people.teamMembers(teamId) })
      if (teamId) {
        qc.invalidateQueries({ queryKey: KEYS.people.team(teamId) })
      }
      qc.invalidateQueries({ queryKey: ['people', 'teams'] })
      qc.invalidateQueries({ queryKey: ['people', 'employees'] })
      toast.success('Команда назначена')
      reset()
      onClose()
    },
  })

  if (!user) return null

  const employeeName = user.full_name ?? user.FullName ?? '—'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Команда — ${employeeName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary"   onClick={() => mutate()} loading={isPending}>Сохранить</Button>
        </>
      }
    >
      {error && (
        <Alert variant="error" className="mb-4">
          {error.response?.data?.error?.message ?? error.message}
        </Alert>
      )}

      <div>
        <label className="input-label">Команда</label>
        <select
          value={teamId}
          onChange={e => setTeamId(e.target.value)}
          className="input mt-1"
        >
          <option value="">Без команды</option>
          {teams.filter(t => t.is_active !== false).map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
    </Modal>
  )
}
