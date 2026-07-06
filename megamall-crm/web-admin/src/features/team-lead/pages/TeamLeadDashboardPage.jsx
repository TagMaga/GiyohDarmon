/**
 * TeamLeadDashboardPage — /team-lead (index)
 *
 * Replaces the static RoleDashboard placeholder.
 * All data sourced from existing APIs — no new backend endpoints.
 *
 * Layout:
 *   1. KPI row (6 tiles): today, period, active sellers, income, delivered, conversion
 *   2. Two-column: Recent orders | Team Performance ranking
 *   3. Two-column: Status distribution | Team Snapshot card
 */
import { useState, useMemo }   from 'react'
import { useNavigate }         from 'react-router-dom'
import {
  ShoppingCart, Package, PackageCheck, TrendingUp, Users,
  BarChart2, ChevronRight, RefreshCw, Users2, Medal, AlertTriangle,
} from 'lucide-react'
import Badge                   from '../../../shared/components/Badge'
import EmptyState              from '../../../shared/components/EmptyState'
import { CardSkeleton }        from '../../../shared/components/Skeleton'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount } from '../../../shared/orderStatusConfig'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import { fmtDate }             from '../../../shared/orderStatusConfig'
import { fmtMoney }            from '../../hr/utils/hrHelpers'
import useCurrentUser          from '../../../shared/hooks/useCurrentUser'
import useMyTeam               from '../hooks/useMyTeam'
import useTeamMembers          from '../../people/hooks/useTeamMembers'
import useEmployeesByIds       from '../../people/hooks/useEmployeesByIds'
import useTeams                from '../../people/hooks/useTeams'
import useTeamIncome           from '../../hr/hooks/useTeamIncome'
import { buildUserMap }        from '../../people/utils/peopleHelpers'
import useOwnerOrders          from '../../orders/hooks/useOwnerOrders'
import useProfile              from '../../../shared/hooks/useProfile'
import { M, MobileShell, DarkCard, Card, InitialsAvatar } from '../../seller/components/mobileUi'

// ── Date helpers ──────────────────────────────────────────────────────────────

function toYMD(d) { return d.toISOString().slice(0, 10) }

function usePeriod() {
  const now   = new Date()
  const today = toYMD(now)
  const monthStart = toYMD(new Date(now.getFullYear(), now.getMonth(), 1))
  return { today, from: monthStart, to: today }
}

// ── Resolvers ─────────────────────────────────────────────────────────────────

function resolveCustomer(o) {
  const name = o.customer_name ?? o.CustomerName ?? o.customer?.full_name ?? o.customer?.name ?? '—'
  return name
}

// ── KPI tile ──────────────────────────────────────────────────────────────────

const ACCENT = {
  indigo:  { tile: 'bg-white/85 border-slate-200/80', icon: 'bg-slate-950 text-white',        val: 'text-slate-950' },
  emerald: { tile: 'bg-white/85 border-slate-200/80', icon: 'bg-emerald-50 text-emerald-700', val: 'text-slate-950' },
  violet:  { tile: 'bg-white/85 border-slate-200/80', icon: 'bg-indigo-50 text-indigo-700',   val: 'text-slate-950' },
  amber:   { tile: 'bg-white/85 border-slate-200/80', icon: 'bg-amber-50 text-amber-700',     val: 'text-slate-950' },
  sky:     { tile: 'bg-white/85 border-slate-200/80', icon: 'bg-sky-50 text-sky-700',         val: 'text-slate-950' },
  rose:    { tile: 'bg-white/85 border-slate-200/80', icon: 'bg-rose-50 text-rose-700',       val: 'text-slate-950' },
}

function KpiTile({ icon, label, value, accent = 'indigo', loading, sub }) {
  const a = ACCENT[accent] ?? ACCENT.indigo
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 shadow-[0_10px_30px_rgba(15,23,42,0.04)] backdrop-blur ${a.tile}`}>
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${a.icon}`}>
          {icon}
        </span>
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide leading-tight">
          {label}
        </p>
      </div>
      {loading
        ? <div className="h-7 w-16 bg-white/70 rounded-lg animate-pulse" />
        : (
          <div>
            <p className={`text-2xl font-bold leading-none ${a.val}`}>{value}</p>
            {sub && <p className="text-[10px] text-slate-400 mt-1">{sub}</p>}
          </div>
        )
      }
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function SectionCard({ title, action, children, loading, emptyTitle, emptyDesc, isEmpty }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-5 flex flex-col gap-4 h-full shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {action}
      </div>
      {loading
        ? <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 rounded-xl animate-pulse" />)}</div>
        : isEmpty
          ? <EmptyState icon={<ShoppingCart size={18}/>} title={emptyTitle ?? 'Нет данных'} description={emptyDesc} />
          : children
      }
    </div>
  )
}

function AttentionNeeded({ orders, userMap, onOpenOrders }) {
  const rows = useMemo(() => {
    const flaggedStatuses = new Set(['cancelled', 'returned', 'issue', 'prepayment_pending'])
    return orders.filter(o => flaggedStatuses.has(o.status ?? o.Status)).slice(0, 5)
  }, [orders])

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-950 text-white p-5 shadow-[0_24px_55px_rgba(15,23,42,0.18)]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
            <AlertTriangle size={16} />
          </span>
          <div>
            <p className="text-sm font-bold">Attention needed</p>
            <p className="text-[11px] text-slate-400">Risk orders from your team only</p>
          </div>
        </div>
        <button onClick={onOpenOrders} className="text-xs font-semibold text-white/80 hover:text-white min-h-[32px]">
          Review
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
          <p className="text-sm font-semibold text-white">No urgent risks</p>
          <p className="text-xs text-slate-400 mt-1">Cancelled, returned, issue and prepayment-pending orders will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((order, i) => {
            const status = order.status ?? order.Status ?? ''
            const sellerId = order.seller_id ?? order.SellerID
            const seller = sellerId ? (userMap[sellerId]?.full_name ?? userMap[sellerId]?.FullName ?? '—') : '—'
            return (
              <button
                key={getOrderId(order) ?? i}
                onClick={onOpenOrders}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left hover:bg-white/[0.07] transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-mono font-bold text-white">{formatOrderLabel(order)}</span>
                  <span className="text-[11px] font-semibold text-amber-200">{STATUS_LABELS[status] ?? status}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 truncate">{resolveCustomer(order)} · {seller}</p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Recent orders list ────────────────────────────────────────────────────────

function RecentOrderRow({ order, userMap }) {
  const status   = order.status ?? order.Status ?? ''
  const amount   = Number(order.total_amount ?? order.amount ?? 0)
  const sellerId = order.seller_id ?? order.SellerID
  const seller   = sellerId
    ? (userMap[sellerId]?.full_name ?? userMap[sellerId]?.FullName ?? '—')
    : '—'

  return (
    <div className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
      {/* Order num + seller */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-indigo-700 flex-shrink-0">
            {formatOrderLabel(order)}
          </span>
          <Badge variant={STATUS_BADGE[status] ?? 'slate'} size="sm">
            {STATUS_LABELS[status] ?? status}
          </Badge>
        </div>
        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
          {resolveCustomer(order)} · {seller}
        </p>
      </div>
      {/* Amount */}
      <span className="text-xs font-bold text-slate-800 flex-shrink-0 whitespace-nowrap">
        {fmtAmount(amount)} смн
      </span>
    </div>
  )
}

// ── Team performance ranking ──────────────────────────────────────────────────

function PerformanceRanking({ orders, userMap }) {
  const ranked = useMemo(() => {
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
    return Object.entries(s)
      .sort(([, a], [, b]) => b.total - a.total)
      .slice(0, 6)
  }, [orders])

  if (!ranked.length) return (
    <p className="text-xs text-slate-400 text-center py-4">Нет данных о заказах</p>
  )

  const maxOrders = ranked[0]?.[1]?.total ?? 1

  return (
    <div className="space-y-3">
      {ranked.map(([id, s], i) => {
        const u    = userMap[id]
        const name = u?.full_name ?? u?.FullName ?? id.slice(0, 8)
        const initials = name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
        const conv = s.total > 0 ? ((s.delivered / s.total) * 100).toFixed(0) : '0'
        const isFirst = i === 0

        return (
          <div key={id} className="flex items-center gap-3">
            {/* Rank badge */}
            <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold ${
              isFirst
                ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                : 'bg-slate-100 text-slate-500'
            }`}>
              {isFirst ? <Medal size={13} className="text-amber-500" /> : i + 1}
            </div>

            {/* Avatar + name */}
            <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0">
              <span className="text-[9px] font-bold text-white">{initials}</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className="text-[11px] font-semibold text-slate-700 truncate">{name}</span>
                <span className="text-[11px] font-bold text-indigo-700 flex-shrink-0">{s.total}</span>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${isFirst ? 'bg-amber-400' : 'bg-indigo-400'}`}
                  style={{ width: `${(s.total / maxOrders) * 100}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                {s.delivered} сдано · {conv}% конв. · {fmtAmount(s.revenue)} смн
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Status distribution ───────────────────────────────────────────────────────

const STATUS_COLOR = {
  new:          'bg-indigo-500',
  confirmed:    'bg-sky-500',
  in_delivery:  'bg-amber-500',
  delivered:    'bg-emerald-500',
  cancelled:    'bg-slate-400',
  returned:     'bg-orange-400',
  issue:        'bg-rose-500',
  prepayment_pending:  'bg-amber-400',
  prepayment_received: 'bg-violet-400',
  assigned:     'bg-violet-500',
}

function StatusDistribution({ orders }) {
  const counts = useMemo(() => {
    const c = {}
    orders.forEach(o => {
      const s = o.status ?? o.Status ?? 'unknown'
      c[s] = (c[s] ?? 0) + 1
    })
    return Object.entries(c).sort(([, a], [, b]) => b - a)
  }, [orders])

  const total = orders.length || 1

  if (!counts.length) return (
    <p className="text-xs text-slate-400 text-center py-4">Нет данных</p>
  )

  return (
    <div className="space-y-2.5">
      {counts.map(([status, count]) => {
        const pct = ((count / total) * 100).toFixed(0)
        return (
          <div key={status} className="flex items-center gap-3">
            <span className="text-[11px] text-slate-500 w-28 flex-shrink-0 truncate">
              {STATUS_LABELS[status] ?? status}
            </span>
            <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${STATUS_COLOR[status] ?? 'bg-slate-400'} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 w-16 justify-end">
              <span className="text-[11px] font-bold text-slate-700">{count}</span>
              <span className="text-[10px] text-slate-400">({pct}%)</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Team snapshot ─────────────────────────────────────────────────────────────

function TeamSnapshot({ team, sellersCount, managerName, leadName, loading }) {
  if (loading) return <CardSkeleton />
  if (!team) return (
    <div className="rounded-2xl bg-slate-50 border border-slate-200 px-5 py-4">
      <p className="text-xs text-slate-400">Команда не определена. Обратитесь к владельцу.</p>
    </div>
  )

  const rows = [
    { label: 'Команда',    value: team.name },
    { label: 'Руководитель', value: leadName  ?? '—' },
    { label: 'Менеджер',   value: managerName ?? 'Не назначен' },
    { label: 'Продавцов',  value: String(sellersCount) },
    { label: 'Статус',     value: team.is_active !== false ? 'Активна' : 'Архив' },
  ]

  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-200 divide-y divide-slate-200">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between px-4 py-2.5">
          <span className="text-xs text-slate-500">{label}</span>
          <span className="text-xs font-semibold text-slate-800">{value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamLeadDashboardPage() {
  const navigate   = useNavigate()
  const { userId } = useCurrentUser()
  const { team, teamId, isLoading: teamLoading } = useMyTeam()
  const { data: members = [],     isLoading: membersLoading } = useTeamMembers(teamId)
  const memberIds = useMemo(() => members.map(m => m.user_id).filter(Boolean), [members])
  const employeeIds = useMemo(
    () => [...new Set([...memberIds, team?.manager_id, userId].filter(Boolean))],
    [memberIds, team?.manager_id, userId]
  )
  const { data: teamEmployees = [] } = useEmployeesByIds(employeeIds)
  const { data: allTeams = [] }     = useTeams()

  const userMap = useMemo(() => buildUserMap(teamEmployees), [teamEmployees])
  const sellers   = useMemo(() =>
    members.map(m => userMap[m.user_id]).filter(u => u && (u.role ?? u.Role) === 'seller'),
    [members, userMap]
  )

  const { today, from, to } = usePeriod()

  // Period orders (current month, large batch for KPIs + analytics)
  const periodParams = useMemo(() => ({
    from, to,
    ...(userId ? { team_lead_id: userId } : {}),
    ...(teamId ? { team_id: teamId }      : {}),
    limit: 500, page: 1,
  }), [from, to, userId, teamId])

  // Today orders
  const todayParams = useMemo(() => ({
    from: today, to: today,
    ...(userId ? { team_lead_id: userId } : {}),
    ...(teamId ? { team_id: teamId }      : {}),
    limit: 200, page: 1,
  }), [today, userId, teamId])

  const { items: periodOrders, isLoading: periodLoading, refetch, isFetching } =
    useOwnerOrders(periodParams)

  const { items: todayOrders, isLoading: todayLoading } =
    useOwnerOrders(todayParams)

  // Team income
  const incomeParams = useMemo(() => ({ from, to }), [from, to])
  const { data: teamIncome, isLoading: incomeLoading } =
    useTeamIncome(userId, incomeParams)

  // Safety-filter all orders to own team's sellers
  const safeFilter = (orders) => {
    if (!memberIds.length) return orders
    return orders.filter(o => {
      const sid = o.seller_id ?? o.SellerID
      return !sid || memberIds.includes(sid)
    })
  }
  const myPeriodOrders = useMemo(() => safeFilter(periodOrders), [periodOrders, memberIds])
  const myTodayOrders  = useMemo(() => safeFilter(todayOrders),  [todayOrders,  memberIds])

  // Derived KPIs
  const delivered  = myPeriodOrders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const conversion = myPeriodOrders.length > 0
    ? ((delivered / myPeriodOrders.length) * 100).toFixed(1)
    : '0.0'
  const incomeTotal = teamIncome?.total_income ?? 0

  // Recent orders (last 10)
  const recentOrders = useMemo(() =>
    [...myPeriodOrders]
      .sort((a, b) => new Date(b.created_at ?? b.CreatedAt ?? 0) - new Date(a.created_at ?? a.CreatedAt ?? 0))
      .slice(0, 10),
    [myPeriodOrders]
  )

  // Team snapshot names
  const managerName = useMemo(() => {
    if (!team?.manager_id) return null
    const u = userMap[team.manager_id]
    return u?.full_name ?? u?.FullName ?? null
  }, [team, userMap])

  const leadName = useMemo(() => {
    if (!userId) return null
    const u = userMap[userId]
    return u?.full_name ?? u?.FullName ?? null
  }, [userId, userMap])

  const dataLoading = teamLoading || membersLoading || periodLoading

  // ── Mobile-only derived values (Teamlead Panel Redesign home screen) ──────
  const { fullName: profileFullName } = useProfile()
  const todaySalesSum = useMemo(
    () => myTodayOrders.reduce((sum, o) => sum + Number(o.total_order_amount ?? o.total_amount ?? o.amount ?? 0), 0),
    [myTodayOrders]
  )
  const activeSellersToday = useMemo(
    () => new Set(myTodayOrders.map(o => o.seller_id ?? o.SellerID).filter(Boolean)).size,
    [myTodayOrders]
  )
  const deliveredToday = myTodayOrders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const topSellers = useMemo(() => {
    const s = {}
    myPeriodOrders.forEach(o => {
      const id = o.seller_id ?? o.SellerID
      if (!id) return
      if (!s[id]) s[id] = { orders: 0, revenue: 0 }
      s[id].orders++
      s[id].revenue += Number(o.total_order_amount ?? o.total_amount ?? o.amount ?? 0)
    })
    return Object.entries(s)
      .map(([id, v]) => ({ id, name: userMap[id]?.full_name ?? userMap[id]?.FullName ?? id.slice(0, 8), ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3)
  }, [myPeriodOrders, userMap])

  return (
    <>
    {/* ═══════════════════════════════════════════════════════════
        MOBILE LAYOUT — Teamlead Panel Redesign
    ═══════════════════════════════════════════════════════════ */}
    <MobileShell>
      <div className="px-5">
        <div className="flex items-center justify-between" style={{ padding: '8px 4px 16px' }}>
          <div>
            <div style={{ fontSize: 13, color: M.sub, fontWeight: 500 }}>Добрый день,</div>
            <div style={{ fontSize: 21, fontWeight: 700, color: M.ink, letterSpacing: '-.01em', marginTop: 1 }}>
              {profileFullName?.split(' ')[0] ?? leadName?.split(' ')[0] ?? 'Тимлид'}
            </div>
          </div>
          <InitialsAvatar name={profileFullName ?? leadName ?? ''} size={42} radius={14} />
        </div>

        <DarkCard>
          <div className="flex items-center gap-[7px]">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34D399' }} />
            <span style={{ fontSize: 12.5, color: M.darkSub, fontWeight: 600, letterSpacing: '.02em' }}>Продажи команды сегодня</span>
          </div>
          <div style={{ fontSize: 42, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1, marginTop: 12 }}>
            {todayLoading ? '…' : fmtAmount(todaySalesSum)} <span style={{ fontSize: 24, fontWeight: 600, color: M.darkMuted }}>с</span>
          </div>
          <div style={{ fontSize: 12.5, color: M.darkMuted, marginTop: 9, fontWeight: 500 }}>
            {myTodayOrders.length} заказ{myTodayOrders.length === 1 ? '' : 'ов'} · {activeSellersToday} продавц{activeSellersToday === 1 ? 'ец' : 'ов'} активно
          </div>
        </DarkCard>

        <div className="grid grid-cols-3 gap-[9px]" style={{ marginTop: 14 }}>
          <Card style={{ borderRadius: 15, padding: '13px 12px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{todayLoading ? '…' : myTodayOrders.length}</div>
            <div style={{ fontSize: 11.5, color: M.sub, fontWeight: 600, marginTop: 2 }}>Заказов</div>
          </Card>
          <Card style={{ borderRadius: 15, padding: '13px 12px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{membersLoading ? '…' : `${activeSellersToday}/${sellers.length}`}</div>
            <div style={{ fontSize: 11.5, color: M.sub, fontWeight: 600, marginTop: 2 }}>Активны</div>
          </Card>
          <Card style={{ borderRadius: 15, padding: '13px 12px' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{todayLoading ? '…' : deliveredToday}</div>
            <div style={{ fontSize: 11.5, color: M.sub, fontWeight: 600, marginTop: 2 }}>Доставлено</div>
          </Card>
        </div>

        <div className="flex items-center justify-between" style={{ margin: '22px 4px 12px' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>Топ продавцов</span>
          <button type="button" onClick={() => navigate('/team-lead/team')} style={{ fontSize: 13, fontWeight: 600, color: M.indigo, background: 'none', border: 'none' }}>Все →</button>
        </div>

        {dataLoading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: M.border }} />)}</div>
        ) : topSellers.length === 0 ? (
          <Card style={{ padding: 20, textAlign: 'center' }}><p style={{ fontSize: 13, color: M.muted }}>Нет данных за период</p></Card>
        ) : (
          <Card style={{ overflow: 'hidden' }}>
            {topSellers.map((s, i) => (
              <div key={s.id} className="flex items-center gap-[11px]" style={{ padding: '13px 15px', borderBottom: i < topSellers.length - 1 ? `1px solid ${M.bg}` : 'none' }}>
                <span
                  className="flex items-center justify-center flex-shrink-0"
                  style={{ width: 22, height: 22, borderRadius: 7, fontSize: 12, fontWeight: 800, background: i === 0 ? '#FEF3C7' : '#F0EFEA', color: i === 0 ? '#B45309' : '#76766E' }}
                >
                  {i + 1}
                </span>
                <InitialsAvatar name={s.name} size={36} palette={i} />
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }} className="truncate">{s.name}</div>
                  <div style={{ fontSize: 11.5, color: M.faint, marginTop: 1 }}>{s.orders} заказ{s.orders === 1 ? '' : 'ов'}</div>
                </div>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: M.ink, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtAmount(s.revenue)} с</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </MobileShell>

    {/* ═══════════════════════════════════════════════════════════
        DESKTOP LAYOUT
    ═══════════════════════════════════════════════════════════ */}
    <div className="hidden lg:block p-4 md:p-6 space-y-5 bg-[#F4F6F8] min-h-screen">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
            <Users2 size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">
              {team?.name ?? 'Моя команда'}
            </h1>
            <p className="text-xs text-slate-400">Team sales, orders, weak spots and payouts · current month</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 transition-all min-h-[44px] flex-shrink-0"
          title="Обновить"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      <AttentionNeeded
        orders={myPeriodOrders}
        userMap={userMap}
        onOpenOrders={() => navigate('/team-lead/orders')}
      />

      {/* ── KPI row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiTile
          icon={<ShoppingCart size={15}/>} label="Сегодня" accent="sky"
          value={todayLoading ? '…' : myTodayOrders.length}
          loading={todayLoading}
          sub={today}
        />
        <KpiTile
          icon={<Package size={15}/>} label="За период" accent="indigo"
          value={dataLoading ? '…' : myPeriodOrders.length}
          loading={dataLoading}
        />
        <KpiTile
          icon={<Users size={15}/>} label="Продавцы" accent="emerald"
          value={membersLoading ? '…' : sellers.length}
          loading={membersLoading}
          sub="активных"
        />
        <KpiTile
          icon={<TrendingUp size={15}/>} label="Доход группы" accent="violet"
          value={incomeLoading ? '…' : fmtMoney(incomeTotal)}
          loading={incomeLoading}
        />
        <KpiTile
          icon={<PackageCheck size={15}/>} label="Доставлено" accent="amber"
          value={dataLoading ? '…' : delivered}
          loading={dataLoading}
        />
        <KpiTile
          icon={<BarChart2 size={15}/>} label="Конверсия" accent="rose"
          value={dataLoading ? '…' : `${conversion}%`}
          loading={dataLoading}
        />
      </div>

      {/* ── Row 2: Recent orders + Team performance ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Recent orders */}
        <SectionCard
          title="Последние заказы"
          loading={dataLoading}
          isEmpty={!dataLoading && recentOrders.length === 0}
          emptyTitle="Заказов пока нет"
          emptyDesc="Заказы вашей команды появятся здесь."
          action={
            <button
              onClick={() => navigate('/team-lead/orders')}
              className="flex items-center gap-0.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors min-h-[32px]"
            >
              Все заказы <ChevronRight size={12}/>
            </button>
          }
        >
          <div className="divide-y divide-slate-50">
            {recentOrders.map((o, i) => (
              <RecentOrderRow key={getOrderId(o) ?? i} order={o} userMap={userMap} />
            ))}
          </div>
        </SectionCard>

        {/* Team performance */}
        <SectionCard
          title="Team ranking"
          loading={dataLoading}
          isEmpty={!dataLoading && myPeriodOrders.length === 0}
          emptyTitle="Нет данных"
          emptyDesc="Статистика появится после первых заказов."
          action={
            <button
              onClick={() => navigate('/team-lead/team')}
              className="flex items-center gap-0.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors min-h-[32px]"
            >
              Подробнее <ChevronRight size={12}/>
            </button>
          }
        >
          <PerformanceRanking orders={myPeriodOrders} userMap={userMap} />
        </SectionCard>
      </div>

      {/* ── Row 3: Status distribution + Team snapshot ──────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Status distribution */}
        <SectionCard
          title="Распределение по статусам"
          loading={dataLoading}
          isEmpty={!dataLoading && myPeriodOrders.length === 0}
          emptyTitle="Нет данных"
          emptyDesc="Статистика появится после первых заказов."
        >
          <StatusDistribution orders={myPeriodOrders} />
        </SectionCard>

        {/* Team snapshot */}
        <div className="rounded-2xl border border-slate-200/80 bg-white/85 p-5 flex flex-col gap-4 shadow-[0_18px_45px_rgba(15,23,42,0.06)] backdrop-blur">
          <p className="text-sm font-bold text-slate-800">Команда</p>
          <TeamSnapshot
            team={team}
            sellersCount={sellers.length}
            managerName={managerName}
            leadName={leadName}
            loading={teamLoading || membersLoading}
          />
          <div className="flex gap-2 flex-wrap mt-auto">
            <button
              onClick={() => navigate('/team-lead/team')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold transition-colors min-h-[36px]"
            >
              <Users size={13}/> Team
            </button>
            <button
              onClick={() => navigate('/team-lead/reports')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors min-h-[36px]"
            >
              <BarChart2 size={13}/> Отчёты
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  )
}
