import { useState, useMemo }  from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient, useQueries } from '@tanstack/react-query'
import { RefreshCw, Plus }    from 'lucide-react'

import PeopleKpis       from '../components/PeopleKpis'
import PeopleTabs       from '../components/PeopleTabs'
import TeamCard         from '../components/TeamCard'
import EmployeeCard     from '../components/EmployeeCard'
import EmployeeFilters  from '../components/EmployeeFilters'
import CreateEmployeeModal from '../components/CreateEmployeeModal'
import CreateTeamModal     from '../components/CreateTeamModal'
import WorkerApplicationCard         from '../components/WorkerApplicationCard'
import WorkerApplicationDetailModal  from '../components/WorkerApplicationDetailModal'
import Button           from '../../../shared/components/Button'
import EmptyState       from '../../../shared/components/EmptyState'
import Alert            from '../../../shared/components/Alert'
import { CardSkeleton } from '../../../shared/components/Skeleton'

import useEmployees  from '../hooks/useEmployees'
import useTeams      from '../hooks/useTeams'
import useGlobalRates   from '../hooks/useGlobalRates'
import useActiveTariff  from '../hooks/useActiveTariff'
import useWorkerApplications from '../hooks/useWorkerApplications'
import { buildUserMap, buildTeamMap, fmtPct, fmtMoney, isConfigActive, COMMISSION_TYPE_LABEL } from '../utils/peopleHelpers'
import { fetchAllConfigs, fetchTeamMembers } from '../api'
import { KEYS } from '../../../shared/queryKeys'
import { useQuery } from '@tanstack/react-query'
import { Users, Users2, FileText, ClipboardList } from 'lucide-react'

// ── Compensation tab ───────────────────────────────────────────────────────────
function CompensationTab({ employees, teams }) {
  const { data: globalRates }   = useGlobalRates()
  const { data: activeTariff }  = useActiveTariff()
  const { data: allConfigs = [] } = useQuery({
    queryKey: KEYS.people.configs({}),
    queryFn:  () => fetchAllConfigs(),
    staleTime: 2 * 60_000,
  })

  const activeConfigs = allConfigs.filter(isConfigActive)

  return (
    <div className="space-y-5">
      {/* Delivery tariff */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Тариф доставки</p>
        {activeTariff ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-900">{activeTariff.name}</p>
              <p className="text-xs text-slate-400">{activeTariff.type === 'fixed' ? 'Фиксированный' : 'Ступенчатый'}</p>
            </div>
            {activeTariff.fixed_fee != null && (
              <p className="text-base font-bold text-sky-700">{fmtMoney(activeTariff.fixed_fee)}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Тариф не настроен</p>
        )}
      </div>

      {/* Global rates */}
      {globalRates && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Глобальные ставки</p>
          <div className="space-y-2">
            {Object.entries(globalRates).map(([key, entry]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-slate-600">{COMMISSION_TYPE_LABEL[entry?.commission_type ?? key] ?? key}</span>
                <span className="text-xs font-bold text-indigo-700">{fmtPct(entry?.rate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active configs list */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
          Активные конфигурации ({activeConfigs.length})
        </p>
        {activeConfigs.length === 0 && <EmptyState icon={<FileText size={18} />} title="Нет активных конфигураций" />}
        <div className="space-y-2">
          {activeConfigs.map((cfg, i) => (
            <div key={cfg.id ?? i} className="card p-3 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">
                  {COMMISSION_TYPE_LABEL[cfg.commission_type] ?? cfg.commission_type}
                </span>
                <span className="font-bold text-indigo-700">{fmtPct(cfg.rate)}</span>
              </div>
              <p className="text-slate-400">
                Область: {cfg.scope} {cfg.user_id ? `· ${cfg.user_id.slice(0,8)}` : ''}{cfg.team_id ? `· ${cfg.team_id.slice(0,8)}` : ''}
              </p>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── Main TeamsHub ──────────────────────────────────────────────────────────────
export default function TeamsHub() {
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()

  const initialTab  = searchParams.get('tab') || 'teams'
  const initialRole = searchParams.get('role') || ''

  const [tab,              setTab]           = useState(initialTab)
  const [search,           setSearch]        = useState('')
  const [roleFilter,       setRoleFilter]    = useState(initialRole)
  const [teamFilter,       setTeamFilter]    = useState('')
  const [showCreate,       setShowCreate]    = useState(false)   // CreateEmployeeModal
  const [showCreateTeam,   setShowCreateTeam] = useState(false)  // CreateTeamModal
  const [selectedApplication, setSelectedApplication] = useState(null)

  const { data: employees = [], isLoading: empLoading, isError: empError } = useEmployees()
  const { data: teams     = [], isLoading: teamLoading }                   = useTeams()
  const { data: applications = [], isLoading: appLoading, isError: appError } = useWorkerApplications('pending')
  const { data: allConfigs = [] } = useQuery({
    queryKey: KEYS.people.configs({}),
    queryFn:  () => fetchAllConfigs(),
    staleTime: 2 * 60_000,
  })

  // Build look-up maps
  const userMap = useMemo(() => buildUserMap(employees), [employees])
  const teamMap = useMemo(() => buildTeamMap(teams),     [teams])

  // Fetch member counts for every team in parallel via hierarchy endpoint.
  // useQueries fires one GET /hierarchy/team/:id/members per team; results are cached
  // under KEYS.people.teamMembers(id) so TeamProfilePage shares the same cache.
  const memberQueries = useQueries({
    queries: teams.map(t => ({
      queryKey: KEYS.people.teamMembers(t.id),
      queryFn:  () => fetchTeamMembers(t.id),
      staleTime: 5 * 60_000,
    })),
  })

  const memberCounts = useMemo(() => {
    const counts = {}
    teams.forEach((t, i) => {
      counts[t.id] = memberQueries[i]?.data?.length ?? 0
    })
    return counts
  }, [teams, memberQueries])

  // Filter employees
  const filtered = useMemo(() => {
    let list = employees
    if (roleFilter) list = list.filter(e => (e.role ?? e.Role) === roleFilter)
    if (teamFilter) {
      // We can't filter by team without hierarchy data here — show all when team filter set
      // (team filter is best used from the TeamProfilePage member list)
      // For now, pass through (requires hierarchy enrichment in future)
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(e =>
        (e.full_name ?? e.FullName ?? '').toLowerCase().includes(q) ||
        (e.phone ?? '').includes(q)
      )
    }
    return list
  }, [employees, roleFilter, teamFilter, search])

  const handleTabChange = (t) => {
    setTab(t)
    setSearchParams(p => { p.set('tab', t); return p }, { replace: true })
  }

  const handleFilterChange = ({ role, team, search: s }) => {
    if (role  !== undefined) setRoleFilter(role)
    if (team  !== undefined) setTeamFilter(team)
    if (s     !== undefined) setSearch(s)
  }

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['people'] })
  }

  const loading = empLoading || teamLoading

  return (
    <div className="p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {tab === 'employees' ? 'Сотрудники'
              : tab === 'applications' ? 'Заявки'
              : tab === 'compensation' ? 'Компенсации' : 'Команды'}
          </h1>
          <p className="text-sm text-slate-400">
            {tab === 'employees' ? 'Управление персоналом'
              : tab === 'applications' ? 'Заявки с giyohdarmon.tj/new, ожидающие рассмотрения'
              : 'Команды, сотрудники и компенсации'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRefresh}
            className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors"
            aria-label="Обновить">
            <RefreshCw size={16} />
          </button>
          {tab === 'teams' && (
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowCreateTeam(true)}>
              Создать команду
            </Button>
          )}
          {tab === 'employees' && (
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowCreate(true)}>
              Добавить
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <PeopleKpis employees={employees} teams={teams} configs={allConfigs} loading={loading} />

      {/* Tabs */}
      <PeopleTabs
        active={tab}
        onChange={handleTabChange}
        counts={{ teams: teams.length, employees: employees.length, applications: applications.length }}
      />

      {/* ── Teams tab ──────────────────────────────────────────────────── */}
      {tab === 'teams' && (
        teamLoading
          ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{[1,2,3].map(i => <CardSkeleton key={i} />)}</div>
          : teams.length === 0
            ? <EmptyState icon={<Users2 size={22} />} title="Нет команд" description="Команды ещё не созданы" />
            : <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {teams.map(t => (
                  <TeamCard key={t.id} team={t} userMap={userMap} memberCount={memberCounts[t.id] ?? 0} />
                ))}
              </div>
      )}

      {/* ── Employees tab ──────────────────────────────────────────────── */}
      {tab === 'employees' && (
        <div className="space-y-4">
          <EmployeeFilters
            roleFilter={roleFilter}
            teamFilter={teamFilter}
            search={search}
            teams={teams}
            onChange={handleFilterChange}
          />
          {empError && <Alert variant="error">Не удалось загрузить список сотрудников</Alert>}
          {empLoading
            ? <div className="space-y-2">{[1,2,3,4].map(i => <CardSkeleton key={i} />)}</div>
            : filtered.length === 0
              ? <EmptyState icon={<Users size={22} />} title="Сотрудники не найдены" />
              : <div className="space-y-2">
                  {filtered.map(u => (
                    <EmployeeCard key={u.id} user={u} teamMap={teamMap} teamId={null} />
                  ))}
                </div>
          }
        </div>
      )}

      {/* ── Applications tab ─────────────────────────────────────────────── */}
      {tab === 'applications' && (
        <div className="space-y-2">
          {appError && <Alert variant="error">Не удалось загрузить заявки</Alert>}
          {appLoading
            ? <div className="space-y-2">{[1,2,3].map(i => <CardSkeleton key={i} />)}</div>
            : applications.length === 0
              ? <EmptyState icon={<ClipboardList size={22} />} title="Нет новых заявок" description="Заявки с формы giyohdarmon.tj/new появятся здесь" />
              : applications.map(a => (
                  <WorkerApplicationCard key={a.id} application={a} onOpen={() => setSelectedApplication(a)} />
                ))
          }
        </div>
      )}

      {/* ── Compensation tab ───────────────────────────────────────────── */}
      {tab === 'compensation' && (
        <CompensationTab employees={employees} teams={teams} />
      )}

      <CreateEmployeeModal open={showCreate}     onClose={() => setShowCreate(false)} />
      <CreateTeamModal     open={showCreateTeam} onClose={() => setShowCreateTeam(false)} users={employees} />
      <WorkerApplicationDetailModal
        key={selectedApplication?.id ?? 'none'}
        application={selectedApplication}
        onClose={() => setSelectedApplication(null)}
      />
    </div>
  )
}
