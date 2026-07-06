/**
 * ManagerDashboardPage — /manager
 *
 * Replaces the RoleDashboard skeleton with real data.
 * KPIs: Заказов команды / Продавцов / Личных заказов / Личный доход
 * Sections: recent team orders, recent personal orders, top sellers list.
 */
import { useMemo }         from 'react'
import { useNavigate }     from 'react-router-dom'
import {
  ShoppingCart, UserCheck, ClipboardList, TrendingUp,
  ChevronRight, Package, PackageCheck, PlusCircle,
} from 'lucide-react'
import Badge               from '../../../shared/components/Badge'
import Alert               from '../../../shared/components/Alert'
import { CardSkeleton }    from '../../../shared/components/Skeleton'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import useCurrentUser      from '../../../shared/hooks/useCurrentUser'
import useMyManagerTeam    from '../hooks/useMyManagerTeam'
import useTeamMembers      from '../../people/hooks/useTeamMembers'
import useEmployeesByIds   from '../../people/hooks/useEmployeesByIds'
import { buildUserMap }    from '../../people/utils/peopleHelpers'
import useManagerOrders    from '../hooks/useManagerOrders'
import useManagerPersonalOrders from '../hooks/useManagerPersonalOrders'
import useMyIncome         from '../../hr/hooks/useMyIncome'
import { fmtMoney }        from '../../hr/utils/hrHelpers'
import { M }               from '../../seller/components/mobileUi'

function toYMD(d) { return d.toISOString().slice(0, 10) }

function currentMonth() {
  const now = new Date()
  return { from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), to: toYMD(now) }
}

// ── KPI tile ─────────────────────────────────────────────────────────────────

function KpiTile({ icon, label, value, accent = 'indigo', loading, onClick }) {
  const cls = {
    indigo:  'bg-indigo-50  text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    sky:     'bg-sky-50     text-sky-600',
    amber:   'bg-amber-50   text-amber-600',
  }[accent] ?? 'bg-indigo-50 text-indigo-600'

  return (
    <button
      onClick={onClick}
      className={`card p-4 flex flex-col gap-2 text-left w-full transition-shadow hover:shadow-md ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${cls}`}>{icon}</span>
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide leading-tight">{label}</p>
      </div>
      {loading
        ? <div className="h-7 w-16 bg-slate-200 rounded-lg animate-pulse" />
        : <p className="text-2xl font-bold text-slate-900 leading-none">{value}</p>}
    </button>
  )
}

// ── Mini order row ────────────────────────────────────────────────────────────

function resolveCustomerName(order) {
  if (order.customer_name) return order.customer_name
  if (order.CustomerName)  return order.CustomerName
  const c = order.customer ?? order.Customer
  return c?.full_name ?? c?.name ?? null
}

function MiniOrderRow({ order, userMap }) {
  const status   = order.status ?? order.Status ?? ''
  const amount   = Number(order.total_amount ?? order.amount ?? 0)
  const sellerId = order.seller_id ?? order.SellerID
  const seller   = sellerId ? (userMap[sellerId]?.full_name ?? userMap[sellerId]?.FullName ?? '—') : '—'
  const customer = resolveCustomerName(order)

  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-50 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold text-indigo-700">{formatOrderLabel(order)}</span>
          <Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">{STATUS_LABELS[status] ?? status}</Badge>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {customer && <span className="text-slate-600 font-medium">{customer} · </span>}
          {seller} · {fmtDate(order.created_at ?? order.CreatedAt)}
        </p>
      </div>
      <span className="text-sm font-bold text-slate-800 flex-shrink-0">{fmtAmount(amount)} смн</span>
    </div>
  )
}

// ── Top sellers ───────────────────────────────────────────────────────────────

function TopSellers({ orders, userMap }) {
  const stats = useMemo(() => {
    const m = {}
    orders.forEach(o => {
      const id = o.seller_id ?? o.SellerID
      if (!id) return
      if (!m[id]) m[id] = { total: 0, delivered: 0 }
      m[id].total++
      if ((o.status ?? o.Status) === 'delivered') m[id].delivered++
    })
    return Object.entries(m).sort(([,a],[,b]) => b.total - a.total).slice(0, 5)
  }, [orders])

  if (!stats.length) return <p className="text-xs text-slate-400 text-center py-3">Нет данных</p>

  return (
    <div className="space-y-2">
      {stats.map(([id, s], i) => {
        const u = userMap[id]
        const name = u?.full_name ?? u?.FullName ?? '—'
        const conv = s.total > 0 ? ((s.delivered / s.total) * 100).toFixed(0) : '0'
        return (
          <div key={id} className="flex items-center gap-3">
            <span className="text-[11px] font-bold text-slate-400 w-4">{i+1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-700 truncate">{name}</p>
              <p className="text-[10px] text-slate-400">{s.total} заказов · {conv}% конверсия</p>
            </div>
            <span className="text-xs font-bold text-indigo-700 flex-shrink-0">{s.total}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ManagerDashboardPage() {
  const navigate = useNavigate()
  const { userId } = useCurrentUser()
  const { teamId, isLoading: teamLoading } = useMyManagerTeam()
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(teamId)
  const memberIds  = useMemo(() => members.map(m => m.user_id).filter(Boolean), [members])
  const employeeIds = useMemo(() => [...new Set([...memberIds, userId].filter(Boolean))], [memberIds, userId])
  const { data: teamEmployees = [] } = useEmployeesByIds(employeeIds)
  const userMap = useMemo(() => buildUserMap(teamEmployees), [teamEmployees])

  const sellers    = useMemo(() =>
    members.map(m => userMap[m.user_id]).filter(u => u && (u.role ?? u.Role) === 'seller'),
    [members, userMap]
  )

  const { from, to } = currentMonth()
  const monthParams = useMemo(() => ({ from, to, limit: 200, page: 1 }), [from, to])

  const { allItems: teamOrders, isLoading: ordersLoading } = useManagerOrders(monthParams, memberIds)
  const { allItems: myOrders,   isLoading: myOrdersLoading } = useManagerPersonalOrders(monthParams)
  const { data: income,         isLoading: incomeLoading } = useMyIncome({ from, to })

  const recentTeam = teamOrders.slice(0, 5)
  const recentMine = myOrders.slice(0, 5)

  const totalDelivered = teamOrders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const incomeTotal    = income?.total_income ?? 0

  const loading = teamLoading || membersLoading || ordersLoading

  return (
    <div className="p-4 md:p-6 space-y-5 pb-28 lg:pb-6" style={{ background: M.bg, fontFamily: M.font, minHeight: '100vh' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Панель менеджера</h1>
          <p className="text-xs text-slate-400 mt-0.5">Текущий месяц · только ваша команда</p>
        </div>
        <button
          onClick={() => navigate('/manager/my-orders/create')}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors flex-shrink-0"
        >
          <PlusCircle size={16} />
          <span className="hidden sm:inline">Новый заказ</span>
        </button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          icon={<ShoppingCart size={16}/>} label="Заказов команды" accent="indigo"
          value={loading ? '…' : teamOrders.length}
          loading={loading}
          onClick={() => navigate('/manager/orders')}
        />
        <KpiTile
          icon={<UserCheck size={16}/>} label="Продавцов" accent="emerald"
          value={membersLoading ? '…' : sellers.length}
          loading={membersLoading}
          onClick={() => navigate('/manager/sellers')}
        />
        <KpiTile
          icon={<ClipboardList size={16}/>} label="Личных заказов" accent="sky"
          value={myOrdersLoading ? '…' : myOrders.length}
          loading={myOrdersLoading}
          onClick={() => navigate('/manager/my-orders')}
        />
        <KpiTile
          icon={<TrendingUp size={16}/>} label="Личный доход" accent="amber"
          value={incomeLoading ? '…' : fmtMoney(incomeTotal)}
          loading={incomeLoading}
          onClick={() => navigate('/manager/income')}
        />
      </div>

      {/* Two-column sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent team orders */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">Заказы команды</p>
            <button onClick={() => navigate('/manager/orders')}
              className="flex items-center gap-0.5 text-xs text-indigo-600 hover:text-indigo-800 font-semibold min-h-[32px]">
              Все <ChevronRight size={12}/>
            </button>
          </div>
          {ordersLoading
            ? <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-10 bg-slate-100 rounded animate-pulse"/>)}</div>
            : recentTeam.length === 0
              ? <p className="text-xs text-slate-400 text-center py-4">Заказов ещё нет</p>
              : recentTeam.map((o,i) => <MiniOrderRow key={getOrderId(o)??i} order={o} userMap={userMap}/>)
          }
        </div>

        {/* Recent personal orders */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">Мои личные заказы</p>
            <button onClick={() => navigate('/manager/my-orders')}
              className="flex items-center gap-0.5 text-xs text-indigo-600 hover:text-indigo-800 font-semibold min-h-[32px]">
              Все <ChevronRight size={12}/>
            </button>
          </div>
          {myOrdersLoading
            ? <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-10 bg-slate-100 rounded animate-pulse"/>)}</div>
            : recentMine.length === 0
              ? <p className="text-xs text-slate-400 text-center py-4">Личных заказов нет</p>
              : recentMine.map((o,i) => <MiniOrderRow key={getOrderId(o)??i} order={o} userMap={userMap}/>)
          }
        </div>
      </div>

      {/* Top sellers */}
      <div className="card p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800">Топ продавцы · текущий месяц</p>
        {ordersLoading
          ? <CardSkeleton />
          : <TopSellers orders={teamOrders} userMap={userMap} />
        }
      </div>
    </div>
  )
}
