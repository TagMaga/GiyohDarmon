import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate }       from 'react-router-dom'
import { useMutation, useQueryClient }  from '@tanstack/react-query'

import Badge             from '../../../shared/components/Badge'
import Button            from '../../../shared/components/Button'
import Alert             from '../../../shared/components/Alert'
import Modal             from '../../../shared/components/Modal'
import { CardSkeleton }  from '../../../shared/components/Skeleton'
import { useToast }      from '../../../shared/components/ToastProvider'

import TeamMembersWithRates from '../components/TeamMembersWithRates'
import TeamPerformance      from '../components/TeamPerformance'

import useTeam           from '../hooks/useTeam'
import useTeamMembers    from '../hooks/useTeamMembers'
import useTeamConfigs    from '../hooks/useTeamConfigs'
import useEmployees      from '../hooks/useEmployees'

import { updateTeam, deleteTeam } from '../api'
import { KEYS }                   from '../../../shared/queryKeys'
import { buildUserMap, userName, fmtDate } from '../utils/peopleHelpers'
import { ArrowLeft, Edit2, PowerOff, Users2 } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// EditTeamModal
// ─────────────────────────────────────────────────────────────────────────────
function EditTeamModal({ open, onClose, team, users }) {
  const qc    = useQueryClient()
  const toast = useToast()

  const [name,       setName]       = useState('')
  const [teamLeadId, setTeamLeadId] = useState('')
  const [managerId,  setManagerId]  = useState('')
  const [isActive,   setIsActive]   = useState(true)

  // Sync form fields whenever the team prop changes (e.g. after an edit round-trip)
  useEffect(() => {
    if (team) {
      setName(team.name ?? '')
      setTeamLeadId(team.team_lead_id ?? '')
      setManagerId(team.manager_id   ?? '')
      setIsActive(team.is_active !== false)
    }
  }, [team])

  const leads    = users.filter(u => ['sales_team_lead'].includes(u.role ?? u.Role ?? ''))
  const managers = users.filter(u => ['manager'].includes(u.role ?? u.Role ?? ''))

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => {
      if (!name.trim()) throw new Error('Название обязательно')
      return updateTeam(team.id, {
        name:         name.trim(),
        team_lead_id: teamLeadId || undefined,
        manager_id:   managerId  || undefined,
        is_active:    isActive,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.people.team(team.id) })
      qc.invalidateQueries({ queryKey: ['people', 'teams'] })
      qc.invalidateQueries({ queryKey: ['people'] })
      toast.success('Команда обновлена')
      reset()
      onClose()
    },
  })

  const handleClose = () => { reset(); onClose() }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Редактировать команду"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="primary"   onClick={() => mutate()} loading={isPending}>Сохранить</Button>
        </>
      }
    >
      {error && (
        <Alert variant="error" className="mb-4">
          {error.response?.data?.error?.message ?? error.message}
        </Alert>
      )}
      <div className="space-y-4">
        <div>
          <label className="input-label">Название *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="input-label">Руководитель группы</label>
          <select value={teamLeadId} onChange={e => setTeamLeadId(e.target.value)} className="input mt-1">
            <option value="">Без руководителя</option>
            {leads.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ?? u.FullName}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="input-label">Менеджер</label>
          <select value={managerId} onChange={e => setManagerId(e.target.value)} className="input mt-1">
            <option value="">Без менеджера</option>
            {managers.map(u => (
              <option key={u.id} value={u.id}>{u.full_name ?? u.FullName}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={e => setIsActive(e.target.checked)}
            className="w-4 h-4 rounded accent-indigo-600"
          />
          <span className="text-sm text-slate-700">Активна</span>
        </label>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DeactivateTeamModal
// ─────────────────────────────────────────────────────────────────────────────
function DeactivateTeamModal({ open, onClose, team, memberCount }) {
  const qc       = useQueryClient()
  const toast    = useToast()
  const navigate = useNavigate()

  const hasMembers = memberCount > 0

  const { mutate, isPending, error, reset } = useMutation({
    mutationFn: () => deleteTeam(team.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['people', 'teams'] })
      qc.invalidateQueries({ queryKey: ['people'] })
      toast.success(`Команда «${team.name}» деактивирована`)
      reset()
      onClose()
      navigate('/owner/teams', { replace: true })
    },
  })

  const handleClose = () => { reset(); onClose() }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Деактивировать команду"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>Отмена</Button>
          <Button variant="danger"    onClick={() => mutate()} loading={isPending}>
            Деактивировать
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <Alert variant="error">
            {error.response?.data?.error?.message ?? error.message}
          </Alert>
        )}

        {hasMembers && (
          <Alert variant="warning">
            В команде {memberCount} {memberCount === 1 ? 'участник' : 'участников'}.
            Деактивация команды не удаляет сотрудников, но они потеряют привязку к этой команде.
          </Alert>
        )}

        <p className="text-sm text-slate-700">
          Вы собираетесь деактивировать команду{' '}
          <span className="font-semibold">«{team?.name}»</span>.
        </p>
        <p className="text-sm text-slate-500">
          Это действие можно отменить позднее через редактирование команды.
          Исторические данные (заказы, правила начисления) сохранятся.
        </p>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section tab config
// ─────────────────────────────────────────────────────────────────────────────
const SECTIONS = [
  { key: 'members',     label: 'Участники' },
  { key: 'performance', label: 'Показатели' },
]

// ─────────────────────────────────────────────────────────────────────────────
// TeamProfilePage
// ─────────────────────────────────────────────────────────────────────────────
export default function TeamProfilePage() {
  const { teamId } = useParams()
  const navigate   = useNavigate()

  const [section,      setSection]      = useState('members')
  const [showEdit,     setShowEdit]     = useState(false)
  const [showDeactivate, setShowDeactivate] = useState(false)

  const { data: team,    isLoading: teamLoading,    isError: teamError }    = useTeam(teamId)
  const { data: members = [], isLoading: membersLoading }                   = useTeamMembers(teamId)
  const { data: configs,   isLoading: configsLoading }                      = useTeamConfigs(teamId)
  const { data: allEmployees = [] }                                          = useEmployees()

  const userMap = useMemo(() => buildUserMap(allEmployees), [allEmployees])

  // ── Loading / error states ───────────────────────────────────────────────
  if (teamLoading) return (
    <div className="p-4 md:p-6 space-y-4">
      <CardSkeleton /><CardSkeleton /><CardSkeleton />
    </div>
  )

  if (teamError || !team) return (
    <div className="p-4 md:p-6">
      <Alert variant="error">Команда не найдена</Alert>
      <Button variant="secondary" onClick={() => navigate('/owner/teams')} className="mt-3">
        Назад
      </Button>
    </div>
  )

  const lead    = team.team_lead_id ? userName(userMap, team.team_lead_id) : null
  const manager = team.manager_id   ? userName(userMap, team.manager_id)   : null

  return (
    <div className="p-4 md:p-6">
      {/* ── Back navigation ───────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/owner/teams')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 min-h-[44px]"
      >
        <ArrowLeft size={15} /> Назад к командам
      </button>

      {/* ── Team identity card ────────────────────────────────────────── */}
      <div className="card p-5 mb-5">
        {/* Header row: icon + name + status + action buttons */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 bg-indigo-100 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Users2 size={22} className="text-indigo-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-900 truncate">{team.name}</h1>
              <p className="text-xs text-slate-400">Создана {fmtDate(team.created_at)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant={team.is_active !== false ? 'emerald' : 'slate'} size="sm">
              {team.is_active !== false ? 'Активна' : 'Архив'}
            </Badge>
            {/* Edit */}
            <button
              onClick={() => setShowEdit(true)}
              className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors"
              title="Редактировать"
            >
              <Edit2 size={14} />
            </button>
            {/* Deactivate — only shown for active teams */}
            {team.is_active !== false && (
              <button
                onClick={() => setShowDeactivate(true)}
                className="w-9 h-9 rounded-xl bg-rose-50 hover:bg-rose-100 flex items-center justify-center text-rose-500 transition-colors"
                title="Деактивировать команду"
              >
                <PowerOff size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Lead / manager info */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="bg-slate-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Руководитель группы</p>
            <p className={`text-sm font-semibold mt-0.5 ${lead ? 'text-slate-800' : 'text-slate-400'}`}>
              {lead ?? 'Не назначен'}
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Менеджер команды</p>
            <p className={`text-sm font-semibold mt-0.5 ${manager ? 'text-slate-800' : 'text-slate-400'}`}>
              {manager ?? 'Не назначен'}
            </p>
          </div>
        </div>

        {/* Member count pill */}
        {!membersLoading && (
          <div className="mt-3">
            <span className="inline-flex items-center gap-1 text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-medium">
              {members.length} {members.length === 1 ? 'участник' : 'участников'}
            </span>
          </div>
        )}
      </div>

      {/* ── Section tabs ──────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 border-b border-slate-200 scrollbar-hide mb-5">
        {SECTIONS.map(s => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={[
              'px-3 py-2.5 min-h-[44px] min-w-max text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-all',
              section === s.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {s.label}
            {s.key === 'members' && !membersLoading && (
              <span className={`ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
                section === 'members' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {members.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      {section === 'members' && (
        <TeamMembersWithRates
          members={members}
          userMap={userMap}
          configs={configs ?? []}
          scopeId={teamId}
          loading={membersLoading || configsLoading}
        />
      )}
      {section === 'performance' && <TeamPerformance team={team} />}

      {/* ── Modals ────────────────────────────────────────────────────── */}
      <EditTeamModal
        open={showEdit}
        onClose={() => setShowEdit(false)}
        team={team}
        users={allEmployees}
      />
      <DeactivateTeamModal
        open={showDeactivate}
        onClose={() => setShowDeactivate(false)}
        team={team}
        memberCount={members.length}
      />
    </div>
  )
}
