/**
 * ManagerSellersPage — /manager/sellers
 *
 * Sellers from manager's team. Heavily reuses TeamLeadSellersPage structure.
 * Stats derived from current-month orders. Click seller → drawer with recent orders.
 */
import { useState, useMemo }  from 'react'
import {
  Users, X, ChevronRight,
  Package, PackageCheck, TrendingUp, BarChart2,
} from 'lucide-react'
import Badge                  from '../../../shared/components/Badge'
import EmptyState             from '../../../shared/components/EmptyState'
import { CardSkeleton }       from '../../../shared/components/Skeleton'
import { STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import useCurrentUser         from '../../../shared/hooks/useCurrentUser'
import useMyManagerTeam       from '../hooks/useMyManagerTeam'
import useTeamMembers         from '../../people/hooks/useTeamMembers'
import useEmployees           from '../../people/hooks/useEmployees'
import { buildUserMap }       from '../../people/utils/peopleHelpers'
import useOwnerOrders         from '../../orders/hooks/useOwnerOrders'

function buildStats(orders) {
  const s = {}
  orders.forEach(o => {
    const id = o.seller_id ?? o.SellerID
    if (!id) return
    if (!s[id]) s[id] = { total: 0, delivered: 0, revenue: 0 }
    s[id].total++
    if ((o.status ?? o.Status) === 'delivered') {
      s[id].delivered++
      s[id].revenue += Number(o.net_revenue ?? o.total_amount ?? o.amount ?? 0)
    }
  })
  return s
}

// ── Seller drawer ─────────────────────────────────────────────────────────────

function SellerDrawer({ seller, orders, onClose }) {
  const open    = !!seller
  const myOrders = useMemo(() =>
    orders.filter(o => (o.seller_id ?? o.SellerID) === seller?.id).slice(0, 20),
    [orders, seller?.id]
  )
  const delivered = myOrders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const revenue   = myOrders.filter(o => (o.status ?? o.Status) === 'delivered')
    .reduce((s, o) => s + Number(o.net_revenue ?? o.total_amount ?? 0), 0)
  const initials  = (seller?.full_name ?? '?').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase()

  return (
    <>
      <div className={`fixed inset-0 bg-slate-900/40 z-40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[420px] bg-white z-50 shadow-2xl flex flex-col transform transition-transform duration-250 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">{initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{seller?.full_name ?? '—'}</p>
              <p className="text-xs text-slate-400">{seller?.phone ?? 'Продавец'}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 p-5 border-b border-slate-100">
          {[
            { label: 'Всего',     value: myOrders.length, icon: <Package size={14}/>,      cls: 'text-indigo-600 bg-indigo-50' },
            { label: 'Сдано',     value: delivered,        icon: <PackageCheck size={14}/>, cls: 'text-emerald-600 bg-emerald-50' },
            { label: 'Выручка',   value: `${fmtAmount(revenue)} сомони`, icon: <TrendingUp size={14}/>, cls: 'text-violet-600 bg-violet-50' },
          ].map(({ label, value, icon, cls }) => (
            <div key={label} className="text-center">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center mx-auto mb-1 ${cls}`}>{icon}</div>
              <p className="text-base font-bold text-slate-800">{value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">
            Последние заказы ({myOrders.length})
          </p>
          {myOrders.length === 0
            ? <p className="text-sm text-slate-400 text-center py-6">Нет заказов за период</p>
            : myOrders.map((o, i) => {
                const status = o.status ?? o.Status ?? ''
                return (
                  <div key={getOrderId(o) ?? i} className="flex items-center justify-between gap-2 py-2 border-b border-slate-50 last:border-0">
                    <div>
                      <p className="text-xs font-mono font-semibold text-indigo-700">{formatOrderLabel(o)}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(o.created_at ?? o.CreatedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-semibold text-slate-700">{fmtAmount(Number(o.total_amount ?? o.amount ?? 0))} сомони</span>
                      <Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">{status}</Badge>
                    </div>
                  </div>
                )
              })
          }
        </div>
      </div>
    </>
  )
}

// ── Seller card ───────────────────────────────────────────────────────────────

function SellerCard({ user, stats, onClick }) {
  const { total = 0, delivered = 0, revenue = 0 } = stats ?? {}
  const conv     = total > 0 ? ((delivered / total) * 100).toFixed(0) : '0'
  const initials = (user.full_name ?? '?').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase()

  return (
    <div className="card p-4 space-y-3 hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <span className="text-xs font-bold text-white">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate">{user.full_name ?? '—'}</p>
          {user.phone && <p className="text-xs text-slate-400">{user.phone}</p>}
        </div>
        <Badge variant={user.is_active !== false ? 'emerald' : 'slate'} size="sm">
          {user.is_active !== false ? 'Активен' : 'Неактивен'}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-2 pt-1 border-t border-slate-50">
        {[
          { label: 'Заказов',  value: total,                      color: 'text-indigo-600',  icon: <Package size={12}/> },
          { label: 'Сдано',    value: delivered,                   color: 'text-emerald-600', icon: <PackageCheck size={12}/> },
          { label: 'Выручка',  value: `${fmtAmount(revenue)} сомони`, color: 'text-violet-600',  icon: <TrendingUp size={12}/> },
          { label: 'Конверс.', value: `${conv}%`,                 color: 'text-amber-600',   icon: <BarChart2 size={12}/> },
        ].map(({ label, value, color, icon }) => (
          <div key={label} className="text-center">
            <div className={`flex items-center justify-center mb-0.5 ${color}`}>{icon}</div>
            <p className="text-sm font-bold text-slate-800">{value}</p>
            <p className="text-[10px] text-slate-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end">
        <span className="text-[11px] text-indigo-600 font-semibold flex items-center gap-0.5">
          Подробнее <ChevronRight size={11}/>
        </span>
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ManagerSellersPage() {
  const [selected, setSelected] = useState(null)
  const { userId } = useCurrentUser()
  const { teamId, isLoading: teamLoading } = useMyManagerTeam()
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(teamId)
  const { data: allEmployees = [] } = useEmployees()
  const userMap = useMemo(() => buildUserMap(allEmployees), [allEmployees])

  const sellers = useMemo(() =>
    members.map(m => userMap[m.user_id]).filter(u => u && (u.role ?? u.Role) === 'seller'),
    [members, userMap]
  )

  const now = new Date()
  const orderParams = useMemo(() => ({
    manager_id: userId,
    ...(teamId ? { team_id: teamId } : {}),
    from:  new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10),
    to:    now.toISOString().slice(0,10),
    limit: 500, page: 1,
  }), [userId, teamId])

  const { items: orders } = useOwnerOrders(orderParams)
  const stats = useMemo(() => buildStats(orders), [orders])
  const loading = teamLoading || membersLoading

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
          <Users size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Продавцы</h1>
          <p className="text-xs text-slate-400">Ваша команда · текущий месяц</p>
        </div>
      </div>

      {loading
        ? <div className="space-y-3">{[1,2,3].map(i=><CardSkeleton key={i}/>)}</div>
        : sellers.length === 0
          ? <EmptyState icon={<Users size={22}/>} title="Продавцы не назначены" description="В вашей команде пока нет продавцов. Обратитесь к руководителю." />
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sellers.map(u => (
                <SellerCard key={u.id} user={u} stats={stats[u.id]} onClick={() => setSelected(u)} />
              ))}
            </div>
          )
      }

      <SellerDrawer seller={selected} orders={orders} onClose={() => setSelected(null)} />
    </div>
  )
}
