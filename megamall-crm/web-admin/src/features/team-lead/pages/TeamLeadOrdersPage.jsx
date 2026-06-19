/**
 * TeamLeadOrdersPage — /team-lead/orders
 *
 * Read-only orders view scoped to the team lead's own team.
 * Reuses: OrderDetailsDrawer, useOwnerOrders (with team-scoped params)
 */
import { useState, useMemo }   from 'react'
import { ClipboardList, RefreshCw } from 'lucide-react'
import Alert                   from '../../../shared/components/Alert'
import OrderDetailsDrawer      from '../../orders/components/OrderDetailsDrawer'
import TeamOrdersKpiBar        from '../components/TeamOrdersKpiBar'
import TeamOrdersFilters       from '../components/TeamOrdersFilters'
import TeamOrdersTable         from '../components/TeamOrdersTable'
import useTeamLeadOrders       from '../hooks/useTeamLeadOrders'
import useMyTeam               from '../hooks/useMyTeam'
import useTeamMembers          from '../../people/hooks/useTeamMembers'
import useEmployees            from '../../people/hooks/useEmployees'
import { buildUserMap }        from '../../people/utils/peopleHelpers'
import useTeams                from '../../people/hooks/useTeams'

function toYMD(d) { return d.toISOString().slice(0, 10) }
function currentMonthDefault() {
  const now = new Date()
  return { from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), to: toYMD(now) }
}

export default function TeamLeadOrdersPage() {
  const def = currentMonthDefault()
  const [filters, setFilters] = useState({ from: def.from, to: def.to, page: 1, limit: 25 })
  const [selected, setSelected] = useState(null)

  const { teamId } = useMyTeam()
  const { data: members = [] } = useTeamMembers(teamId)
  const { data: allEmployees = [] } = useEmployees()
  const { data: allTeams = [] } = useTeams()

  const userMap = useMemo(() => buildUserMap(allEmployees), [allEmployees])
  const teamMap = useMemo(() => {
    const m = {}
    allTeams.forEach(t => { if (t.id) m[t.id] = t })
    return m
  }, [allTeams])

  const memberIds = useMemo(() => members.map(m => m.user_id).filter(Boolean), [members])
  const sellers   = useMemo(() =>
    members
      .map(m => userMap[m.user_id])
      .filter(u => u && (u.role ?? u.Role) === 'seller'),
    [members, userMap]
  )

  const {
    items, meta, allItems, isLoading, isError, error, refetch, isFetching, allLoading,
  } = useTeamLeadOrders(filters, memberIds)

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
            <ClipboardList size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Заказы команды</h1>
            <p className="text-xs text-slate-400">Только заказы вашей группы</p>
          </div>
        </div>
        <button onClick={() => refetch()} disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 transition-all min-h-[44px] flex-shrink-0">
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {isError && (
        <Alert variant="error">{error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка загрузки'}</Alert>
      )}

      <TeamOrdersKpiBar orders={allItems} loading={allLoading} />

      <TeamOrdersFilters
        filters={filters}
        onChange={setFilters}
        sellers={sellers}
      />

      <TeamOrdersTable
        orders={items}
        meta={meta}
        page={filters.page ?? 1}
        onPage={page => setFilters(f => ({ ...f, page }))}
        loading={isLoading}
        userMap={userMap}
        onView={setSelected}
      />

      <OrderDetailsDrawer
        order={selected}
        onClose={() => setSelected(null)}
        userMap={userMap}
        teamMap={teamMap}
      />
    </div>
  )
}
