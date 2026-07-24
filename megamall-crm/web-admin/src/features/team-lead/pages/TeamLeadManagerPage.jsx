/**
 * TeamLeadManagerPage — /team-lead/managers
 *
 * Shows the manager assigned to the team lead's team.
 * If no manager assigned → empty state.
 *
 * Stats derived from orders data (no owner-only finance endpoints used).
 */
import { useMemo }       from 'react'
import { UserCircle2, Package, PackageCheck, TrendingUp, BarChart2 } from 'lucide-react'
import Badge             from '../../../shared/components/Badge'
import EmptyState        from '../../../shared/components/EmptyState'
import { CardSkeleton }  from '../../../shared/components/Skeleton'
import { fmtAmount }     from '../../../shared/orderStatusConfig'
import useMyTeam         from '../hooks/useMyTeam'
import useEmployeesByIds from '../../people/hooks/useEmployeesByIds'
import { buildUserMap }  from '../../people/utils/peopleHelpers'
import useOwnerOrders    from '../../orders/hooks/useOwnerOrders'
import useCurrentUser    from '../../../shared/hooks/useCurrentUser'
import { toLocalYMD }    from '../../../shared/utils/date'

function StatCard({ icon, label, value, accent = 'indigo' }) {
  const cls = {
    indigo:  'bg-indigo-50  text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet:  'bg-violet-50  text-violet-600',
    amber:   'bg-amber-50   text-amber-600',
  }[accent] ?? 'bg-indigo-50 text-indigo-600'

  return (
    <div className="bg-slate-50 rounded-2xl p-4 flex flex-col items-center gap-2">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${cls}`}>{icon}</div>
      <p className="text-lg font-bold text-slate-800">{value}</p>
      <p className="text-[11px] text-slate-400 text-center leading-tight">{label}</p>
    </div>
  )
}

export default function TeamLeadManagerPage() {
  const { userId } = useCurrentUser()
  const { team, teamId, isLoading: teamLoading } = useMyTeam()
  const managerId = team?.manager_id ?? null
  const employeeIds = useMemo(() => managerId ? [managerId] : [], [managerId])
  const { data: employees = [], isLoading: empLoading } = useEmployeesByIds(employeeIds)
  const userMap = useMemo(() => buildUserMap(employees), [employees])
  const manager   = managerId ? userMap[managerId] : null

  // Orders for this period
  const now = new Date()
  const orderParams = useMemo(() => ({
    team_lead_id: userId,
    ...(teamId ? { team_id: teamId } : {}),
    from:  toLocalYMD(new Date(now.getFullYear(), now.getMonth(), 1)),
    to:    toLocalYMD(now),
    limit: 500,
    page:  1,
  }), [userId, teamId])

  const { items: orders } = useOwnerOrders(orderParams)

  // Manager stats: count orders where manager_id matches
  const managerStats = useMemo(() => {
    if (!managerId) return null
    const teamOrders     = orders.length
    const delivered      = orders.filter(o => (o.status ?? o.Status) === 'delivered').length
    const personalOrders = orders.filter(o => (o.manager_id ?? o.ManagerID) === managerId).length
    const revenue        = orders
      .filter(o => (o.status ?? o.Status) === 'delivered')
      .reduce((s, o) => s + Number(o.net_revenue ?? o.total_amount ?? 0), 0)
    return { teamOrders, delivered, personalOrders, revenue }
  }, [orders, managerId])

  const loading = teamLoading || empLoading

  const initials = manager
    ? (manager.full_name ?? '?').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase()
    : '?'

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600 flex-shrink-0">
          <UserCircle2 size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Менеджер команды</h1>
          <p className="text-xs text-slate-400">Показатели за текущий месяц</p>
        </div>
      </div>

      {loading ? (
        <CardSkeleton />
      ) : !managerId ? (
        <EmptyState
          icon={<UserCircle2 size={24} />}
          title="Менеджер команды не назначен"
          description="Обратитесь к владельцу, чтобы назначить менеджера для вашей команды."
        />
      ) : (
        <div className="space-y-5">
          {/* Identity card */}
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-violet-600 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-white">{initials}</span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-slate-900">{manager?.full_name ?? '—'}</h2>
                {manager?.phone && <p className="text-sm text-slate-500 mt-0.5">{manager.phone}</p>}
                <div className="mt-2 flex gap-2 flex-wrap">
                  <Badge variant="violet" size="sm">Менеджер</Badge>
                  <Badge variant={manager?.is_active !== false ? 'emerald' : 'slate'} size="sm">
                    {manager?.is_active !== false ? 'Активен' : 'Неактивен'}
                  </Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Performance stats */}
          {managerStats && (
            <div className="card p-5">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-4">
                Показатели · текущий месяц
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard icon={<Package size={16}/>}      label="Заказов команды"     value={managerStats.teamOrders}                    accent="indigo"  />
                <StatCard icon={<PackageCheck size={16}/>} label="Доставлено"          value={managerStats.delivered}                     accent="emerald" />
                <StatCard icon={<BarChart2 size={16}/>}    label="Личные заказы"       value={managerStats.personalOrders}                accent="amber"   />
                <StatCard icon={<TrendingUp size={16}/>}   label="Выручка команды"     value={`${fmtAmount(managerStats.revenue)} с`}     accent="violet"  />
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 px-5 py-4">
            <p className="text-xs text-slate-500 leading-relaxed">
              Детальные данные о комиссионных начислениях менеджера доступны в разделе{' '}
              <strong className="text-slate-700">Мой доход → Команда</strong>.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
