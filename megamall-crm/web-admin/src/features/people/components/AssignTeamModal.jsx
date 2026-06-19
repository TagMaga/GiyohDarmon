import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQueryClient }  from '@tanstack/react-query'
import Button  from '../../../shared/components/Button'
import Alert   from '../../../shared/components/Alert'
import Modal   from '../../../shared/components/Modal'
import { useToast } from '../../../shared/components/ToastProvider'
import { KEYS }     from '../../../shared/queryKeys'
import { assignHierarchy, updateTeam } from '../api'
import { ROLE_LABEL, userName, buildUserMap } from '../utils/peopleHelpers'
import { Info } from 'lucide-react'

/**
 * Resolve the suggested parent_id for a given employee role + selected team.
 *
 * Rules (per spec):
 *   seller, courier, dispatcher, warehouse_manager
 *     → team.manager_id  OR  team.team_lead_id
 *   manager
 *     → team.team_lead_id  (no further fallback — owner hierarchy is implicit)
 *   sales_team_lead / owner
 *     → null  (reports to no one inside the team)
 */
function autoParent(role, team) {
  if (!team) return ''
  switch (role) {
    case 'seller':
    case 'courier':
    case 'dispatcher':
    case 'warehouse_manager':
      return team.manager_id ?? team.team_lead_id ?? ''
    case 'manager':
      return team.team_lead_id ?? ''
    case 'sales_team_lead':
    case 'owner':
    default:
      return ''
  }
}

/**
 * AssignTeamModal — sets team and optional direct manager for an employee.
 *
 * Props:
 *   open     {bool}
 *   onClose  {function}
 *   user     {object}      employee being assigned
 *   teams    {Array}       list of active teams
 *   users    {Array}       all users (for parent selector)
 *   current  {object|null} current hierarchy entry { team_id, parent_id }
 */
export default function AssignTeamModal({ open, onClose, user, teams = [], users = [], current = null }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [teamId,        setTeamId]        = useState(current?.team_id   ?? '')
  const [parentId,      setParentId]      = useState(current?.parent_id ?? '')
  const [autoHint,      setAutoHint]      = useState('')   // name of auto-selected parent
  const [userOverrode,  setUserOverrode]  = useState(false)

  const userMap = useMemo(() => buildUserMap(users), [users])
  const role    = user?.role ?? user?.Role ?? ''

  // Re-init when the modal opens or user changes
  useEffect(() => {
    if (open) {
      setTeamId(current?.team_id   ?? '')
      setParentId(current?.parent_id ?? '')
      setAutoHint('')
      setUserOverrode(false)
    }
  }, [open, user?.id])   // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select parent when team changes (unless the user has manually overridden)
  useEffect(() => {
    if (userOverrode) return
    const selectedTeam = teams.find(t => t.id === teamId)
    const suggested    = autoParent(role, selectedTeam)
    setParentId(suggested)
    if (suggested) {
      const name = userName(userMap, suggested)
      setAutoHint(name && name !== suggested ? name : '')
    } else {
      setAutoHint('')
    }
  }, [teamId])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleParentChange = (val) => {
    setParentId(val)
    setUserOverrode(true)
    setAutoHint('')
  }

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: async () => {
      // 1. Always write the hierarchy row
      await assignHierarchy({
        user_id:   user.id,
        team_id:   teamId   || undefined,
        parent_id: parentId || undefined,
      })

      // 2. If the assigned employee IS a manager/lead, also update the team record
      //    so team.manager_id / team.team_lead_id stays in sync.
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

  // Parent candidate list: exclude current employee;
  // include managers, team leads, and owners
  const potentialParents = users.filter(u =>
    u.id !== user.id &&
    ['manager', 'sales_team_lead', 'owner'].includes(u.role ?? u.Role ?? '')
  )

  const employeeName = user.full_name ?? user.FullName ?? '—'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Команда и руководитель — ${employeeName}`}
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

      {/* Helper hint */}
      <div className="flex gap-2 bg-slate-50 rounded-xl px-3 py-2.5 mb-5">
        <Info size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-slate-500 leading-relaxed">
          Команда определяет отдел. Непосредственный руководитель — кому сотрудник
          подчиняется внутри команды.
        </p>
      </div>

      <div className="space-y-5">
        {/* Team selector */}
        <div>
          <label className="input-label">Команда</label>
          <select
            value={teamId}
            onChange={e => { setTeamId(e.target.value); setUserOverrode(false) }}
            className="input mt-1"
          >
            <option value="">Без команды</option>
            {teams.filter(t => t.is_active !== false).map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Parent / direct manager selector */}
        <div>
          <label className="input-label">Непосредственный руководитель</label>
          <select
            value={parentId}
            onChange={e => handleParentChange(e.target.value)}
            className="input mt-1"
          >
            <option value="">Без непосредственного руководителя</option>
            {potentialParents.map(u => {
              const rLabel = ROLE_LABEL[u.role ?? u.Role ?? ''] ?? (u.role ?? u.Role ?? '')
              const name   = u.full_name ?? u.FullName ?? u.id
              return (
                <option key={u.id} value={u.id}>
                  {name} · {rLabel}
                </option>
              )
            })}
          </select>

          {/* Auto-selection hint */}
          {autoHint && !userOverrode && (
            <p className="text-xs text-indigo-600 mt-1.5">
              Автоматически выбран руководитель команды: <span className="font-semibold">{autoHint}</span>
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
