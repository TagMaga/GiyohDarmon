import { useState, useMemo }      from 'react'
import { useParams, useNavigate } from 'react-router-dom'

import Badge             from '../../../shared/components/Badge'
import Button            from '../../../shared/components/Button'
import Alert             from '../../../shared/components/Alert'
import { CardSkeleton }  from '../../../shared/components/Skeleton'

import CompensationSection  from '../components/CompensationSection'
import CourierPayoutSection from '../components/CourierPayoutSection'
import EmployeePerformance  from '../components/EmployeePerformance'
import EditEmployeeModal    from '../components/EditEmployeeModal'
import AssignTeamModal      from '../components/AssignTeamModal'

import useEmployee          from '../hooks/useEmployee'
import useEmployeeConfigs   from '../hooks/useEmployeeConfigs'
import useEmployeeHierarchy from '../hooks/useEmployeeHierarchy'
import useTeams             from '../hooks/useTeams'
import useEmployees         from '../hooks/useEmployees'

import { buildUserMap, buildTeamMap, ROLE_LABEL, ROLE_BADGE, isCourier, isCommissionRole, fmtDate, userName, teamName } from '../utils/peopleHelpers'
import { ArrowLeft, Edit2, GitBranch, Phone } from 'lucide-react'

import IncomeKpiCards        from '../../hr/components/IncomeKpiCards'
import IncomeByTypeBreakdown from '../../hr/components/IncomeByTypeBreakdown'
import IncomeEventsTable     from '../../hr/components/IncomeEventsTable'
import IncomePeriodFilter    from '../../hr/components/IncomePeriodFilter'
import useUserIncome         from '../../hr/hooks/useUserIncome'

// ── Section tabs ───────────────────────────────────────────────────────────────
// Commission roles get compensation/income tabs; couriers get a delivery-payout tab.
const SECTIONS = [
  { key: 'identity',     label: 'Профиль' },
  { key: 'compensation', label: 'Компенсации' },
  { key: 'performance',  label: 'Показатели' },
  { key: 'income',       label: 'Доходы' },
]

const COURIER_SECTIONS = [
  { key: 'identity',    label: 'Профиль' },
  { key: 'delivery',    label: 'Доставка' },
  { key: 'performance', label: 'Показатели' },
]

function currentMonthDefault() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: start.toISOString().slice(0, 10),
    to:   now.toISOString().slice(0, 10),
  }
}

// ── Income tab component ──────────────────────────────────────────────────────
function EmployeeIncomeTab({ userId, isCourierRole }) {
  const [incFrom, setIncFrom] = useState(() => currentMonthDefault().from)
  const [incTo,   setIncTo]   = useState(() => currentMonthDefault().to)

  const incomeParams = { from: incFrom, to: incTo, include_events: true }
  const { data: report, isLoading, isError, error } = useUserIncome(userId, incomeParams)

  if (isCourierRole) {
    return (
      <Alert variant="info">
        Доходы курьеров рассчитываются по тарифу доставки. Подробности — в панели диспетчера.
      </Alert>
    )
  }

  return (
    <div className="space-y-5">
      {/* Period filter */}
      <div className="card p-4">
        <IncomePeriodFilter
          from={incFrom}
          to={incTo}
          onChange={(f, t) => { setIncFrom(f); setIncTo(t) }}
        />
      </div>

      {isError && (
        <Alert variant="error">
          {error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка загрузки'}
        </Alert>
      )}

      <IncomeKpiCards report={report} loading={isLoading} />

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">Разбивка по типам</h3>
        <IncomeByTypeBreakdown
          byEventType={report?.by_event_type ?? {}}
          totalIncome={report?.total_income ?? 0}
          loading={isLoading}
        />
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-4">История начислений</h3>
        <IncomeEventsTable
          events={report?.events ?? []}
          loading={isLoading}
        />
      </div>
    </div>
  )
}

export default function EmployeeProfilePage() {
  const { userId } = useParams()
  const navigate   = useNavigate()

  const [section,     setSection]    = useState('identity')
  const [showEdit,    setShowEdit]   = useState(false)
  const [showAssign,  setShowAssign] = useState(false)

  const { data: user,      isLoading: userLoading,    isError: userError }    = useEmployee(userId)
  const { data: configs,   isLoading: configsLoading }                        = useEmployeeConfigs(userId)
  const { data: chain,     isLoading: chainLoading }                          = useEmployeeHierarchy(userId)
  const { data: teams = [] }                                                   = useTeams()
  const { data: allUsers = [] }                                                = useEmployees()

  const userMap = useMemo(() => buildUserMap(allUsers), [allUsers])
  const teamMap = useMemo(() => buildTeamMap(teams),    [teams])

  if (userLoading) return (
    <div className="p-4 md:p-6 space-y-4">
      <CardSkeleton /><CardSkeleton /><CardSkeleton />
    </div>
  )
  if (userError || !user) return (
    <div className="p-4">
      <Alert variant="error">Сотрудник не найден</Alert>
      <Button variant="secondary" onClick={() => navigate('/owner/employees')} className="mt-3">Назад</Button>
    </div>
  )

  const role     = user.role ?? user.Role ?? ''
  const initials = (user.full_name ?? '?').slice(0, 2).toUpperCase()
  const courier  = isCourier(user)
  const sections = courier ? COURIER_SECTIONS : SECTIONS

  // Current team from hierarchy chain (first entry is the user themselves)
  const currentChainEntry = (chain ?? []).find(e => e.user_id === userId)
  const currentTeamId     = currentChainEntry?.team_id   ?? null
  const currentParentId   = currentChainEntry?.parent_id ?? null

  return (
    <div className="p-4 md:p-6">
      {/* Back */}
      <button onClick={() => navigate('/owner/employees')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 min-h-[44px]">
        <ArrowLeft size={15} /> Назад
      </button>

      {/* Identity card */}
      <div className="card p-5 mb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-lg font-bold text-white">{initials}</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">{user.full_name ?? user.FullName}</h1>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <Badge variant={ROLE_BADGE[role] ?? 'slate'}>
                  {ROLE_LABEL[role] ?? role}
                </Badge>
                {user.is_active === false && <Badge variant="rose">Неактивен</Badge>}
              </div>
            </div>
          </div>
          <button onClick={() => setShowEdit(true)}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 flex-shrink-0">
            <Edit2 size={14} />
          </button>
        </div>

        {/* Contact */}
        <div className="mt-4 space-y-2">
          <a href={`tel:${user.phone}`}
            className="flex items-center gap-2 text-sm text-slate-700 hover:text-indigo-600 min-h-[44px]">
            <Phone size={14} className="text-slate-400 flex-shrink-0" />
            {user.phone}
          </a>
          {user.email && (
            <p className="text-sm text-slate-500">{user.email}</p>
          )}
          <p className="text-xs text-slate-400">Создан {fmtDate(user.created_at)}</p>
        </div>

        {/* Team & chain */}
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Команда и иерархия</p>
            <button onClick={() => setShowAssign(true)}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 min-h-[44px]">
              <GitBranch size={12} /> Назначить
            </button>
          </div>

          {chainLoading ? (
            <p className="text-xs text-slate-400">Загрузка…</p>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Команда</span>
                <span className="font-semibold text-slate-800">
                  {currentTeamId ? teamName(teamMap, currentTeamId) : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Руководитель</span>
                <span className="font-semibold text-slate-800">
                  {currentParentId ? userName(userMap, currentParentId) : '—'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 overflow-x-auto pb-0.5 border-b border-slate-200 scrollbar-hide mb-5">
        {sections.map(s => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={[
              'px-3 py-2.5 min-h-[44px] min-w-max text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-all',
              section === s.key ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}>
            {s.label}
          </button>
        ))}
      </div>

      {/* Profile tab — extra role-specific info */}
      {section === 'identity' && (
        <div className="space-y-3">
          {courier && (
            <Alert variant="info">
              Тариф выплат курьеру и города обслуживания настраиваются во вкладке «Доставка».
            </Alert>
          )}
          <div className="card p-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Детали</p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div><p className="text-slate-400">Роль</p><p className="font-semibold mt-0.5">{ROLE_LABEL[role] ?? role}</p></div>
              <div><p className="text-slate-400">Статус</p><p className={`font-semibold mt-0.5 ${user.is_active !== false ? 'text-emerald-600' : 'text-rose-600'}`}>{user.is_active !== false ? 'Активен' : 'Неактивен'}</p></div>
              <div><p className="text-slate-400">Телефон</p><p className="font-semibold mt-0.5">{user.phone}</p></div>
              <div><p className="text-slate-400">Email</p><p className="font-semibold mt-0.5">{user.email ?? '—'}</p></div>
              <div><p className="text-slate-400">Создан</p><p className="font-semibold mt-0.5">{fmtDate(user.created_at)}</p></div>
              <div><p className="text-slate-400">Обновлён</p><p className="font-semibold mt-0.5">{fmtDate(user.updated_at)}</p></div>
            </div>
          </div>
        </div>
      )}

      {section === 'delivery' && courier && (
        <CourierPayoutSection courierId={userId} />
      )}

      {section === 'compensation' && (
        <CompensationSection
          configs={configs ?? []}
          scope="employee"
          scopeId={userId}
          loading={configsLoading}
          readOnly={courier}
          courierNote={courier}
        />
      )}

      {section === 'performance' && <EmployeePerformance user={user} />}

      {section === 'income' && (
        <EmployeeIncomeTab userId={userId} isCourierRole={courier} />
      )}

      <EditEmployeeModal open={showEdit}   onClose={() => setShowEdit(false)}   user={user} />
      <AssignTeamModal
        open={showAssign}
        onClose={() => setShowAssign(false)}
        user={user}
        teams={teams}
        users={allUsers}
        current={{ team_id: currentTeamId, parent_id: currentParentId }}
      />
    </div>
  )
}
