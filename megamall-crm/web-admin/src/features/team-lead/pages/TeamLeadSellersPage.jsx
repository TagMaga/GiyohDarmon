/**
 * TeamLeadSellersPage — /team-lead/sellers
 *
 * Shows sellers from own team only.
 * Cards: name, phone, orders count, delivered, total sales, conversion.
 * Click → drawer with recent orders + income note.
 *
 * Performance stats derived from orders data (no separate income API per seller
 * to avoid RBAC issues — owner-only endpoints are not called here).
 */
import { useState, useMemo }  from 'react'
import { Users, X, ChevronRight, Package, PackageCheck, TrendingUp, BarChart2 } from 'lucide-react'
import Badge                  from '../../../shared/components/Badge'
import EmptyState             from '../../../shared/components/EmptyState'
import { CardSkeleton }       from '../../../shared/components/Skeleton'
import { STATUS_BADGE, fmtAmount } from '../../../shared/orderStatusConfig'
import useMyTeam              from '../hooks/useMyTeam'
import useTeamMembers         from '../../people/hooks/useTeamMembers'
import useEmployeesByIds      from '../../people/hooks/useEmployeesByIds'
import { buildUserMap }       from '../../people/utils/peopleHelpers'
import useOwnerOrders         from '../../orders/hooks/useOwnerOrders'
import useCurrentUser         from '../../../shared/hooks/useCurrentUser'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import { fmtDate }            from '../../../shared/orderStatusConfig'

function toYMD(d) { return d.toISOString().slice(0, 10) }

// ── Per-seller stats derived from orders ─────────────────────────────────────

function buildSellerStats(orders) {
  const stats = {}
  orders.forEach(o => {
    const id = o.seller_id ?? o.SellerID
    if (!id) return
    if (!stats[id]) stats[id] = { total: 0, delivered: 0, revenue: 0 }
    stats[id].total++
    if ((o.status ?? o.Status) === 'delivered') {
      stats[id].delivered++
      stats[id].revenue += Number(o.net_revenue ?? o.total_amount ?? o.amount ?? 0)
    }
  })
  return stats
}

// ── Seller detail drawer ──────────────────────────────────────────────────────

function SellerDrawer({ seller, orders, onClose }) {
  const open = !!seller
  if (!seller) return null

  const myOrders = useMemo(() =>
    orders.filter(o => (o.seller_id ?? o.SellerID) === seller.id).slice(0, 20),
    [orders, seller?.id]
  )

  const delivered = myOrders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const revenue   = myOrders
    .filter(o => (o.status ?? o.Status) === 'delivered')
    .reduce((s, o) => s + Number(o.net_revenue ?? o.total_amount ?? 0), 0)
  const initials  = (seller.full_name ?? '?').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase()

  return (
    <>
      <div className={`fixed inset-0 bg-slate-900/40 z-40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose} />
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[420px] bg-white z-50 shadow-2xl flex flex-col transform transition-transform duration-250 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-bold text-white">{initials}</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{seller.full_name ?? '—'}</p>
              <p className="text-xs text-slate-400">{seller.phone ?? 'Продавец'}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-colors flex-shrink-0">
            <X size={15} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 p-5 border-b border-slate-100">
          {[
            { label: 'Всего', value: myOrders.length, icon: <Package size={14} />, accent: 'text-indigo-600 bg-indigo-50' },
            { label: 'Доставлено', value: delivered, icon: <PackageCheck size={14} />, accent: 'text-emerald-600 bg-emerald-50' },
            { label: 'Выручка', value: `${fmtAmount(revenue)} сомони`, icon: <TrendingUp size={14} />, accent: 'text-violet-600 bg-violet-50' },
          ].map(({ label, value, icon, accent }) => (
            <div key={label} className="text-center">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center mx-auto mb-1 ${accent}`}>{icon}</div>
              <p className="text-base font-bold text-slate-800">{value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {/* Recent orders */}
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-3">
            Последние заказы ({myOrders.length})
          </p>
          {myOrders.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Нет заказов за период</p>
          ) : (
            <div className="space-y-2">
              {myOrders.map((o, i) => {
                const status = o.status ?? o.Status ?? ''
                const amount = Number(o.total_amount ?? o.amount ?? 0)
                return (
                  <div key={getOrderId(o) ?? i} className="flex items-center justify-between gap-2 py-2 border-b border-slate-50 last:border-0">
                    <div className="min-w-0">
                      <p className="text-xs font-mono font-semibold text-indigo-700">{formatOrderLabel(o)}</p>
                      <p className="text-[11px] text-slate-400">{fmtDate(o.created_at ?? o.CreatedAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs font-semibold text-slate-700">{fmtAmount(amount)} сомони</span>
                      <Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">{status}</Badge>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Seller card ───────────────────────────────────────────────────────────────

function SellerCard({ user, stats, onClick }) {
  const { total = 0, delivered = 0, revenue = 0 } = stats ?? {}
  const conversion = total > 0 ? ((delivered / total) * 100).toFixed(0) : '0'
  const initials   = (user.full_name ?? '?').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase()

  return (
    <div className="card p-4 space-y-3 hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      {/* Header */}
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

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-2 pt-1 border-t border-slate-50">
        {[
          { label: 'Заказов', value: total,                     icon: <Package size={12}/>,      color: 'text-indigo-600' },
          { label: 'Сдано',   value: delivered,                  icon: <PackageCheck size={12}/>, color: 'text-emerald-600' },
          { label: 'Выручка', value: `${fmtAmount(revenue)} сомони`, icon: <TrendingUp size={12}/>,  color: 'text-violet-600' },
          { label: 'Конверс.', value: `${conversion}%`,         icon: <BarChart2 size={12}/>,    color: 'text-amber-600' },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="text-center">
            <div className={`flex items-center justify-center mb-0.5 ${color}`}>{icon}</div>
            <p className="text-sm font-bold text-slate-800">{value}</p>
            <p className="text-[10px] text-slate-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end">
        <span className="text-[11px] text-indigo-600 font-semibold flex items-center gap-0.5">
          Подробнее <ChevronRight size={11} />
        </span>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamLeadSellersPage() {
  const [selectedSeller, setSelectedSeller] = useState(null)
  const { userId } = useCurrentUser()
  const { teamId, isLoading: teamLoading } = useMyTeam()
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(teamId)
  const memberIds = useMemo(() => members.map(m => m.user_id).filter(Boolean), [members])
  const { data: teamEmployees = [] } = useEmployeesByIds(memberIds)
  const userMap = useMemo(() => buildUserMap(teamEmployees), [teamEmployees])

  const sellers = useMemo(() =>
    members
      .map(m => userMap[m.user_id])
      .filter(u => u && (u.role ?? u.Role) === 'seller'),
    [members, userMap]
  )

  // Orders for performance stats
  const now = new Date()
  const orderParams = useMemo(() => ({
    team_lead_id: userId,
    ...(teamId ? { team_id: teamId } : {}),
    from:  new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10),
    to:    now.toISOString().slice(0,10),
    limit: 500,
    page:  1,
  }), [userId, teamId])

  const { items: orders } = useOwnerOrders(orderParams)
  const sellerStats = useMemo(() => buildSellerStats(orders), [orders])

  const loading = teamLoading || membersLoading

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 flex-shrink-0">
          <Users size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Продавцы</h1>
          <p className="text-xs text-slate-400">Участники вашей команды · текущий месяц</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <CardSkeleton key={i} />)}</div>
      ) : sellers.length === 0 ? (
        <EmptyState
          icon={<Users size={22}/>}
          title="Продавцы не назначены"
          description="В вашей команде пока нет продавцов. Обратитесь к владельцу."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sellers.map(u => (
            <SellerCard
              key={u.id}
              user={u}
              stats={sellerStats[u.id]}
              onClick={() => setSelectedSeller(u)}
            />
          ))}
        </div>
      )}

      <SellerDrawer
        seller={selectedSeller}
        orders={orders}
        onClose={() => setSelectedSeller(null)}
      />
    </div>
  )
}
