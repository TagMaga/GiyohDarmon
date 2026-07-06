/**
 * ManagerSellersPage — /manager/sellers
 *
 * Sellers from manager's team, ranked by current-month revenue (podium + list).
 * Stats derived from current-month orders. Click seller → drawer with recent orders.
 */
import { useState, useMemo }  from 'react'
import {
  Users, X, ChevronRight, Crown, Medal,
  Package, PackageCheck, TrendingUp,
} from 'lucide-react'
import Badge                  from '../../../shared/components/Badge'
import EmptyState             from '../../../shared/components/EmptyState'
import { CardSkeleton }       from '../../../shared/components/Skeleton'
import { STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import useCurrentUser         from '../../../shared/hooks/useCurrentUser'
import useMyManagerTeam       from '../hooks/useMyManagerTeam'
import useTeamMembers         from '../../people/hooks/useTeamMembers'
import useEmployeesByIds      from '../../people/hooks/useEmployeesByIds'
import { buildUserMap }       from '../../people/utils/peopleHelpers'
import useOwnerOrders         from '../../orders/hooks/useOwnerOrders'
import { M, Card, SectionLabel, InitialsAvatar } from '../../seller/components/mobileUi'

const MONTH_LABEL = new Date().toLocaleDateString('ru-RU', { month: 'long' })

const MEDAL_KEYS = ['gold', 'silver', 'bronze']
const MEDAL_STYLE = {
  gold:   { icon: Crown, ring: '#F0D48A', shadow: '0 18px 34px -14px rgba(224,169,59,.5)',  badgeBg: '#FBEFD6', badgeColor: '#B45309', lift: 0,  size: 64, font: 20, place: '1' },
  silver: { icon: Medal, ring: '#DBDDE2', shadow: '0 12px 26px -14px rgba(20,20,25,.28)',   badgeBg: '#EDEEF1', badgeColor: '#5B6068', lift: 24, size: 54, font: 17, place: '2' },
  bronze: { icon: Medal, ring: '#E4CDBB', shadow: '0 12px 26px -14px rgba(20,20,25,.28)',   badgeBg: '#F3E7DD', badgeColor: '#9A5B2E', lift: 24, size: 54, font: 17, place: '3' },
}

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

// ── Podium (top 3 by revenue) ─────────────────────────────────────────────────

function PodiumCard({ user, medal, onClick }) {
  const cfg  = MEDAL_STYLE[medal]
  const Icon = cfg.icon
  return (
    <div
      onClick={onClick}
      className="cursor-pointer text-center relative"
      style={{ background: '#fff', border: `1px solid ${cfg.ring}`, borderRadius: 18, padding: '20px 10px 16px', marginTop: cfg.lift, boxShadow: cfg.shadow }}
    >
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{ top: -14, width: 30, height: 30, borderRadius: 10, background: cfg.badgeBg, color: cfg.badgeColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon size={16} />
      </div>
      <div className="mx-auto" style={{ width: cfg.size, marginTop: 8, marginBottom: 10, borderRadius: '50%', border: `3px solid ${cfg.ring}`, display: 'inline-flex' }}>
        <InitialsAvatar name={user.full_name} size={cfg.size - 6} palette={MEDAL_KEYS.indexOf(medal)} />
      </div>
      <div className="truncate" style={{ fontSize: 14, fontWeight: 800, color: M.ink, maxWidth: 130, marginLeft: 'auto', marginRight: 'auto' }}>{user.full_name}</div>
      <div style={{ fontSize: 11.5, color: M.muted, marginTop: 1 }}>{cfg.place} место</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 10 }}>{fmtAmount(user.stats.revenue)}</div>
      <div style={{ fontSize: 10.5, color: M.faint, fontWeight: 600 }}>сомони</div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ManagerSellersPage() {
  const [selected, setSelected] = useState(null)
  const { userId } = useCurrentUser()
  const { teamId, isLoading: teamLoading } = useMyManagerTeam()
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(teamId)
  const memberIds = useMemo(() => members.map(m => m.user_id).filter(Boolean), [members])
  const { data: teamEmployees = [] } = useEmployeesByIds(memberIds)
  const userMap = useMemo(() => buildUserMap(teamEmployees), [teamEmployees])

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

  const ranked = useMemo(() =>
    sellers
      .map(u => ({ ...u, stats: stats[u.id] ?? { total: 0, delivered: 0, revenue: 0 } }))
      .sort((a, b) => b.stats.revenue - a.stats.revenue),
    [sellers, stats]
  )
  const podium      = ranked.slice(0, 3)
  const podiumOrder = podium.length === 3 ? [podium[1], podium[0], podium[2]] : podium
  const rest         = ranked.slice(3)
  const topRevenue    = podium[0]?.stats.revenue ?? 0
  const totalRevenue = ranked.reduce((s, u) => s + u.stats.revenue, 0)

  return (
    <div style={{ fontFamily: M.font, background: M.bg, minHeight: '100vh' }} className="p-4 md:p-6 lg:p-[44px] space-y-0 pb-28 lg:pb-[44px]">
      <div className="flex items-baseline gap-2" style={{ marginBottom: 20 }}>
        <h1 className="lg:!text-[28px]" style={{ fontSize: 20, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', margin: 0 }}>Продавцы</h1>
        <span style={{ fontSize: 12, color: M.muted, fontWeight: 500 }}>Ваша команда · {ranked.length} продавцов</span>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i=><CardSkeleton key={i}/>)}</div>
      ) : sellers.length === 0 ? (
        <EmptyState icon={<Users size={22}/>} title="Продавцы не назначены" description="В вашей команде пока нет продавцов. Обратитесь к руководителю." />
      ) : (
        <>
          {/* Dark hero: team revenue + leader */}
          <div
            className="lg:!rounded-[22px] lg:!p-[26px]"
            style={{ background: 'linear-gradient(135deg,#20202A,#17171C)', borderRadius: 20, padding: 20, color: '#fff', position: 'relative', overflow: 'hidden', marginBottom: 18 }}
          >
            <div style={{ position: 'absolute', right: -30, top: -40, width: 170, height: 170, borderRadius: '50%', background: 'radial-gradient(circle,rgba(99,102,241,.35),transparent 70%)' }} />
            <div style={{ position: 'relative' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#9A99C4' }}>Команда · {MONTH_LABEL}</div>
              <div className="flex items-baseline gap-3" style={{ marginTop: 8 }}>
                <span className="lg:!text-[44px]" style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-.03em', lineHeight: 1 }}>{fmtAmount(totalRevenue)}</span>
                <span style={{ fontSize: 13, color: '#8E8DA0', fontWeight: 600 }}>сомони выручки</span>
              </div>
              {podium[0] && (
                <div style={{ fontSize: 12, color: '#8E8DA0', fontWeight: 500, marginTop: 10 }}>
                  Лидер месяца — <span style={{ color: '#fff', fontWeight: 700 }}>{podium[0].full_name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Podium top 3 */}
          {podium.length > 0 && (
            <div className="grid grid-cols-3 gap-3 md:gap-4 items-end" style={{ marginBottom: 22 }}>
              {podiumOrder.map(u => (
                <PodiumCard key={u.id} user={u} medal={MEDAL_KEYS[podium.indexOf(u)]} onClick={() => setSelected(u)} />
              ))}
            </div>
          )}

          {/* Rest of ranking */}
          {rest.length > 0 && (
            <Card className="overflow-hidden">
              <div style={{ padding: '14px 20px', fontSize: 11, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: M.muted, borderBottom: `1px solid ${M.bg}` }}>
                Остальные продавцы
              </div>
              {rest.map((u, i) => {
                const pct = topRevenue > 0 ? Math.round(u.stats.revenue / topRevenue * 100) : 0
                return (
                  <div
                    key={u.id}
                    onClick={() => setSelected(u)}
                    className="flex items-center gap-3 md:gap-[14px] cursor-pointer hover:bg-[#FAFAF7] transition-colors"
                    style={{ padding: '12px 20px', borderBottom: i < rest.length - 1 ? `1px solid ${M.bg}` : 'none' }}
                  >
                    <div style={{ width: 24, textAlign: 'center', fontSize: 14, fontWeight: 800, color: M.muted, flexShrink: 0 }}>{i + 4}</div>
                    <InitialsAvatar name={u.full_name} size={36} palette={i} />
                    <div className="flex-1 min-w-0">
                      <div className="truncate" style={{ fontSize: 14, fontWeight: 700, color: M.ink }}>{u.full_name}</div>
                      <div style={{ height: 5, borderRadius: 3, background: '#F0EFEA', marginTop: 8, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: M.indigo, borderRadius: 3 }} />
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div style={{ fontSize: 14, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{fmtAmount(u.stats.revenue)}</div>
                      <div style={{ fontSize: 10.5, color: M.faint, fontWeight: 600 }}>сомони</div>
                    </div>
                    <ChevronRight size={16} style={{ color: M.faint, flexShrink: 0 }} />
                  </div>
                )
              })}
            </Card>
          )}
        </>
      )}

      <SellerDrawer seller={selected} orders={orders} onClose={() => setSelected(null)} />
    </div>
  )
}
