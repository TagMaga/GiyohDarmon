/**
 * ManagerDashboardPage - /manager
 *
 * Manager home screen styled after the supplied UI/UX feedback.
 * Uses real manager team data and keeps the orders tab/page untouched.
 */
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Crown, TrendingUp } from 'lucide-react'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { formatOrderLabel, getOrderId } from '../../dispatcher/utils/orderHelpers'
import useProfile from '../../../shared/hooks/useProfile'
import useCurrentUser from '../../../shared/hooks/useCurrentUser'
import useMyManagerTeam from '../hooks/useMyManagerTeam'
import useTeamMembers from '../../people/hooks/useTeamMembers'
import useEmployeesByIds from '../../people/hooks/useEmployeesByIds'
import { buildUserMap } from '../../people/utils/peopleHelpers'
import useManagerOrders from '../hooks/useManagerOrders'
import { M, Card, InitialsAvatar, SectionLabel, StatusPill } from '../../seller/components/mobileUi'

function toYMD(d) {
  return d.toISOString().slice(0, 10)
}

function currentMonth() {
  const now = new Date()
  return {
    from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toYMD(now),
    label: now.toLocaleDateString('ru-RU', { month: 'long' }),
  }
}

function firstName(fullName) {
  return fullName?.trim().split(/\s+/)[0] || 'Менеджер'
}

function deliveredRevenue(orders) {
  return orders
    .filter(o => (o.status ?? o.Status) === 'delivered')
    .reduce((sum, o) => sum + Number(o.net_revenue ?? o.total_amount ?? o.amount ?? 0), 0)
}

function resolveCustomerName(order) {
  if (order.customer_name) return order.customer_name
  if (order.CustomerName) return order.CustomerName
  const c = order.customer ?? order.Customer
  return c?.full_name ?? c?.name ?? 'Клиент'
}

function buildSellerStats(orders) {
  const stats = {}
  orders.forEach(order => {
    const id = order.seller_id ?? order.SellerID
    if (!id) return
    if (!stats[id]) stats[id] = { total: 0, delivered: 0, revenue: 0 }
    stats[id].total += 1
    if ((order.status ?? order.Status) === 'delivered') {
      stats[id].delivered += 1
      stats[id].revenue += Number(order.net_revenue ?? order.total_amount ?? order.amount ?? 0)
    }
  })
  return stats
}

function sellerRows({ sellers, stats }) {
  return sellers
    .map(user => ({ ...user, stats: stats[user.id] ?? { total: 0, delivered: 0, revenue: 0 } }))
    .sort((a, b) => b.stats.revenue - a.stats.revenue)
}

function TeamRevenueHero({ revenue, totalOrders, deliveredCount, leader, monthLabel, loading }) {
  const conversion = totalOrders > 0 ? Math.round((deliveredCount / totalOrders) * 100) : 0

  return (
    <div
      className="relative overflow-hidden text-white"
      style={{
        background: 'linear-gradient(135deg,#20202A,#161619)',
        borderRadius: 22,
        padding: '28px 30px',
      }}
    >
      <div
        className="absolute"
        style={{
          right: '18%',
          top: -60,
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'radial-gradient(circle,rgba(99,102,241,.32),transparent 70%)',
        }}
      />
      <div className="relative flex flex-col xl:flex-row xl:items-end xl:justify-between gap-7">
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9A99C4' }}>
            Выручка команды · {monthLabel}
          </div>
          <div className="flex items-baseline gap-3 mt-3">
            <span className="text-[38px] md:text-[46px] font-black leading-none text-white">
              {loading ? '...' : fmtAmount(revenue)}
            </span>
            <span style={{ fontSize: 14, color: '#8E8DA0', fontWeight: 600 }}>с</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-4">
            <span
              className="inline-flex items-center gap-1"
              style={{ background: 'rgba(52,211,153,.14)', color: '#34D399', fontSize: 12.5, fontWeight: 700, padding: '4px 9px', borderRadius: 8 }}
            >
              <TrendingUp size={13} />
              {conversion}%
            </span>
            <span style={{ fontSize: 12.5, color: '#8E8DA0' }}>
              конверсия · лидер месяца <span style={{ color: '#fff', fontWeight: 700 }}>{leader?.full_name ?? 'пока нет'}</span>
            </span>
          </div>
        </div>

        <div className="flex items-end gap-6">
          <div className="flex gap-5">
            <HeroMetric value={loading ? '...' : totalOrders} label="Заказов" />
            <HeroDivider />
            <HeroMetric value={loading ? '...' : deliveredCount} label="Доставлено" />
            <HeroDivider />
            <HeroMetric value={loading ? '...' : `${conversion}%`} label="Конверсия" />
          </div>
          <div className="hidden md:flex items-end gap-[5px] h-14">
            {[38, 56, 44, 72, 60, 88, 100].map((h, index) => (
              <span
                key={h}
                style={{
                  width: 8,
                  height: `${h}%`,
                  background: index > 4 ? '#818CF8' : 'rgba(255,255,255,.16)',
                  borderRadius: 3,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function HeroMetric({ value, label }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#fff' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#7E7E96', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function HeroDivider() {
  return <div style={{ width: 1, background: 'rgba(255,255,255,.08)' }} />
}

function TeamOrderRow({ order, userMap, compact = false }) {
  const status = order.status ?? order.Status ?? ''
  const sellerId = order.seller_id ?? order.SellerID
  const seller = sellerId ? (userMap[sellerId]?.full_name ?? userMap[sellerId]?.FullName ?? 'Продавец') : 'Продавец'
  const sellerShort = seller.split(/\s+/).slice(0, 2).join(' ')
  const amount = Number(order.total_amount ?? order.amount ?? 0)

  return (
    <div
      className="flex items-center justify-between gap-3"
      style={{ padding: compact ? '12px 0' : '12px 18px', borderTop: compact ? 'none' : `1px solid ${M.bg}`, borderBottom: compact ? `1px solid ${M.bg}` : 'none' }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: compact ? 10.5 : 11, fontWeight: 700, color: M.faint }}>{formatOrderLabel(order)}</span>
          <span className="truncate" style={{ fontSize: compact ? 10.5 : 11, color: M.sub }}>{sellerShort}</span>
        </div>
        <div className="truncate" style={{ fontSize: compact ? 14 : 14.5, fontWeight: 700, color: M.ink, marginTop: 3 }}>
          {resolveCustomerName(order)}
        </div>
        {compact && (
          <div style={{ fontSize: 11.5, color: M.muted, marginTop: 2 }}>{fmtDate(order.created_at ?? order.CreatedAt)}</div>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <StatusPill status={status} />
        <div style={{ fontSize: compact ? 13 : 14, fontWeight: 800, color: M.ink, marginTop: compact ? 5 : 0, display: compact ? 'block' : 'none' }}>
          {fmtAmount(amount)}
        </div>
      </div>
      {!compact && (
        <span style={{ fontSize: 14, fontWeight: 800, color: M.ink, width: 86, textAlign: 'right', flexShrink: 0 }}>
          {fmtAmount(amount)} с
        </span>
      )}
    </div>
  )
}

function TopSellerRow({ user, index, maxRevenue, onClick, compact = false }) {
  const pct = maxRevenue > 0 ? Math.max(4, Math.round((user.stats.revenue / maxRevenue) * 100)) : 0
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center text-left transition-colors hover:bg-[#FAFAF7]"
      style={{ gap: compact ? 12 : 12, padding: compact ? '12px 0' : '0', borderBottom: compact ? `1px solid ${M.bg}` : 'none' }}
    >
      <div style={{ width: compact ? 17 : 26, display: 'flex', justifyContent: 'center', color: index === 0 ? '#B45309' : M.muted, fontSize: 14, fontWeight: 800 }}>
        {index === 0 ? <Crown size={17} fill="#E0A93B" strokeWidth={1.5} /> : index + 1}
      </div>
      <InitialsAvatar name={user.full_name} size={compact ? 34 : 36} palette={index} />
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: compact ? 14 : 13.5, fontWeight: 700, color: M.ink }}>{user.full_name}</div>
        <div style={{ height: 5, borderRadius: 3, background: '#F0EFEA', marginTop: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: M.indigo, borderRadius: 3 }} />
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div style={{ fontSize: 13.5, fontWeight: 800, color: M.ink }}>{fmtAmount(user.stats.revenue)}</div>
        <div style={{ fontSize: 10, color: M.faint, fontWeight: 600 }}>с</div>
      </div>
    </button>
  )
}

export default function ManagerDashboardPage() {
  const navigate = useNavigate()
  const { fullName } = useProfile()
  const { userId } = useCurrentUser()
  const { team, teamId, isLoading: teamLoading } = useMyManagerTeam()
  const { data: members = [], isLoading: membersLoading } = useTeamMembers(teamId)
  const memberIds = useMemo(() => members.map(m => m.user_id).filter(Boolean), [members])
  const employeeIds = useMemo(() => [...new Set([...memberIds, userId].filter(Boolean))], [memberIds, userId])
  const { data: teamEmployees = [] } = useEmployeesByIds(employeeIds)
  const userMap = useMemo(() => buildUserMap(teamEmployees), [teamEmployees])

  const sellers = useMemo(() =>
    members.map(m => userMap[m.user_id]).filter(u => u && (u.role ?? u.Role) === 'seller'),
    [members, userMap]
  )

  const { from, to, label: monthLabel } = currentMonth()
  const monthParams = useMemo(() => ({ from, to, limit: 500, page: 1 }), [from, to])
  const { allItems: teamOrders, isLoading: ordersLoading } = useManagerOrders(monthParams, memberIds)
  const loading = teamLoading || membersLoading || ordersLoading

  const deliveredCount = teamOrders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const revenue = deliveredRevenue(teamOrders)
  const sellerStats = useMemo(() => buildSellerStats(teamOrders), [teamOrders])
  const rankedSellers = useMemo(() => sellerRows({ sellers, stats: sellerStats }), [sellers, sellerStats])
  const topSellers = rankedSellers.slice(0, 5)
  const leader = topSellers[0]
  const maxRevenue = topSellers[0]?.stats.revenue ?? 0
  const recentTeam = teamOrders.slice(0, 5)

  return (
    <div style={{ fontFamily: M.font, background: M.bg, minHeight: '100vh' }} className="p-5 md:p-6 lg:p-[44px] pb-28 lg:pb-[44px]">
      <div className="hidden lg:block">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 style={{ margin: 0, fontSize: 25, fontWeight: 800, color: M.ink }}>Добрый день, {firstName(fullName)}</h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: M.sub }}>
              {team?.name ? `Команда "${team.name}"` : 'Ваша команда'} · {monthLabel}
            </p>
          </div>
        </div>

        <div style={{ marginTop: 22 }}>
          <TeamRevenueHero
            revenue={revenue}
            totalOrders={teamOrders.length}
            deliveredCount={deliveredCount}
            leader={leader}
            monthLabel={monthLabel}
            loading={loading}
          />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)] gap-5" style={{ marginTop: 20 }}>
          <Card style={{ borderRadius: 18, padding: '8px 4px 6px', overflow: 'hidden' }}>
            <div className="flex items-center justify-between" style={{ padding: '12px 18px 10px' }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: M.ink }}>Заказы команды</span>
              <button
                type="button"
                onClick={() => navigate('/manager/orders')}
                className="inline-flex items-center gap-0.5"
                style={{ fontSize: 12.5, fontWeight: 700, color: M.indigoDeep }}
              >
                Все <ChevronRight size={13} />
              </button>
            </div>
            {loading ? (
              <div className="p-4 space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-[#F4F3EF] rounded-xl animate-pulse" />)}</div>
            ) : recentTeam.length === 0 ? (
              <div className="text-center py-8" style={{ fontSize: 13, color: M.muted }}>Заказов команды пока нет</div>
            ) : (
              recentTeam.map((order, index) => <TeamOrderRow key={getOrderId(order) ?? index} order={order} userMap={userMap} />)
            )}
          </Card>

          <Card style={{ borderRadius: 18, padding: 18 }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: M.ink }}>Топ продавцы</span>
              <button
                type="button"
                onClick={() => navigate('/manager/sellers')}
                style={{ fontSize: 12.5, fontWeight: 700, color: M.indigoDeep }}
              >
                Все →
              </button>
            </div>
            {loading ? (
              <CardSkeleton />
            ) : topSellers.length === 0 ? (
              <div className="text-center py-8" style={{ fontSize: 13, color: M.muted }}>Нет данных по продавцам</div>
            ) : (
              <div className="flex flex-col gap-4">
                {topSellers.map((seller, index) => (
                  <TopSellerRow
                    key={seller.id}
                    user={seller}
                    index={index}
                    maxRevenue={maxRevenue}
                    onClick={() => navigate('/manager/sellers')}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="lg:hidden">
        <div className="flex items-baseline gap-2" style={{ paddingTop: 6 }}>
          <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, color: M.ink }}>Главная</h1>
          <span style={{ fontSize: 13, color: M.muted, fontWeight: 600 }}>{monthLabel}</span>
        </div>

        <div style={{ marginTop: 16 }}>
          <TeamRevenueHero
            revenue={revenue}
            totalOrders={teamOrders.length}
            deliveredCount={deliveredCount}
            leader={leader}
            monthLabel={monthLabel}
            loading={loading}
          />
        </div>

        <div className="flex items-center justify-between" style={{ margin: '22px 4px 10px' }}>
          <SectionLabel style={{ margin: 0 }}>Топ продавцы</SectionLabel>
          <button type="button" onClick={() => navigate('/manager/sellers')} style={{ fontSize: 12.5, fontWeight: 700, color: M.indigoDeep }}>
            Все →
          </button>
        </div>
        <Card style={{ borderRadius: 16, padding: '6px 15px' }}>
          {loading ? (
            <CardSkeleton />
          ) : topSellers.length === 0 ? (
            <div className="text-center py-6" style={{ fontSize: 13, color: M.muted }}>Нет данных по продавцам</div>
          ) : (
            topSellers.slice(0, 3).map((seller, index) => (
              <TopSellerRow
                key={seller.id}
                user={seller}
                index={index}
                maxRevenue={maxRevenue}
                compact
                onClick={() => navigate('/manager/sellers')}
              />
            ))
          )}
        </Card>

        <div className="flex items-center justify-between" style={{ margin: '22px 4px 10px' }}>
          <SectionLabel style={{ margin: 0 }}>Заказы команды</SectionLabel>
          <button type="button" onClick={() => navigate('/manager/orders')} style={{ fontSize: 12.5, fontWeight: 700, color: M.indigoDeep }}>
            Все →
          </button>
        </div>
        <Card style={{ borderRadius: 16, padding: '4px 15px' }}>
          {loading ? (
            <div className="space-y-2 py-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-[#F4F3EF] rounded-xl animate-pulse" />)}</div>
          ) : recentTeam.length === 0 ? (
            <div className="text-center py-6" style={{ fontSize: 13, color: M.muted }}>Заказов команды пока нет</div>
          ) : (
            recentTeam.slice(0, 4).map((order, index) => <TeamOrderRow key={getOrderId(order) ?? index} order={order} userMap={userMap} compact />)
          )}
        </Card>
      </div>
    </div>
  )
}
