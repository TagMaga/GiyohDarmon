import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import useSellerOrders from '../hooks/useSellerOrders'
import { useSellerCompensation, useSellerTeamRank, useSellerMe } from '../hooks/useSellerMe'
import OrderDetailBottomSheet from '../components/OrderDetailBottomSheet'
import { M, MobileShell, Card, DarkCard, StatTile, StatusPill, InitialsAvatar, PrimaryButton } from '../components/mobileUi'
import { fetchCities } from '../api'
import { KEYS } from '../../../shared/queryKeys'

function calcStats(orders = []) {
  const today = new Date().toDateString()
  const ACTIVE = new Set(['new', 'confirmed', 'prepayment_pending', 'prepayment_received', 'assigned', 'in_delivery'])
  let todayEarnings = 0, todayCount = 0, activeCount = 0, deliveredCount = 0, prepaymentCount = 0
  for (const o of orders) {
    if (new Date(o.created_at).toDateString() === today) {
      todayCount++
      if (o.status === 'delivered') todayEarnings += o.net_revenue ?? 0
    }
    if (ACTIVE.has(o.status)) activeCount++
    if (o.status === 'delivered') deliveredCount++
    if (o.status === 'prepayment_pending') prepaymentCount++
  }
  return { todayEarnings, todayCount, activeCount, deliveredCount, prepaymentCount }
}

export default function SellerHome() {
  const [detailOrder, setDetailOrder] = useState(null)
  const { orders = [], isLoading } = useSellerOrders()
  const { data: compensation } = useSellerCompensation()
  const { data: rankData } = useSellerTeamRank()
  const { data: me } = useSellerMe()
  const { data: cities = [] } = useQuery({ queryKey: KEYS.seller.cities, queryFn: fetchCities, staleTime: 10 * 60 * 1000 })

  const citiesById = useMemo(() => Object.fromEntries(cities.map(c => [c.id, c.name])), [cities])
  const stats = useMemo(() => calcStats(orders), [orders])
  const commissionPct = compensation?.commission_rate != null ? +(compensation.commission_rate * 100).toFixed(1) : null
  const rank = rankData?.rank ?? null
  const recent = orders.slice(0, 5)
  const firstName = me?.full_name?.split(' ')[0] ?? null

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT  (lg and up) — Seller Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:flex flex-col gap-[22px]" style={{ padding: '36px 44px', fontFamily: M.font }}>

        {/* Greeting */}
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontSize: 14, color: M.sub, fontWeight: 500 }}>Добрый день,</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: M.ink, letterSpacing: '-.01em', marginTop: 2 }}>
              {firstName ?? '—'}
            </div>
          </div>
        </div>

        {/* Earnings hero + stat tiles */}
        <div className="grid gap-5" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
          <DarkCard style={{ padding: '28px 30px' }}>
            <div className="flex items-center gap-[7px]">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34D399' }} />
              <span style={{ fontSize: 12.5, color: M.darkSub, fontWeight: 600, letterSpacing: '.02em' }}>Заработано сегодня</span>
            </div>
            <div style={{ fontSize: 52, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1, marginTop: 16 }}>
              {isLoading ? '—' : fmtAmount(stats.todayEarnings)}{' '}
              <span style={{ fontSize: 28, fontWeight: 600, color: M.darkMuted }}>с</span>
            </div>
            <div style={{ fontSize: 13, color: M.darkMuted, marginTop: 12, fontWeight: 500 }}>
              {isLoading ? 'Загрузка…' : `${stats.todayCount} заказов сегодня · ${stats.deliveredCount} доставлено`}
            </div>
          </DarkCard>
          <div className="flex flex-col" style={{ justifyContent: 'space-between' }}>
            <Link to="/seller/orders" state={{ statusFilter: 'confirmed' }} style={{ display: 'block' }}>
              <Card style={{ borderRadius: 16, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: M.sub, fontWeight: 600 }}>В работе</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{isLoading ? '—' : stats.activeCount}</span>
              </Card>
            </Link>
            <Link to="/seller/orders" state={{ statusFilter: 'delivered' }} style={{ display: 'block' }}>
              <Card style={{ borderRadius: 16, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: M.sub, fontWeight: 600 }}>Доставлено</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: M.ink, letterSpacing: '-.01em' }}>{isLoading ? '—' : stats.deliveredCount}</span>
              </Card>
            </Link>
            <Card style={{ borderRadius: 16, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13, color: M.sub, fontWeight: 600 }}>{commissionPct !== null ? 'Мой процент' : 'В команде'}</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: commissionPct !== null ? M.green : M.ink, letterSpacing: '-.01em' }}>
                {commissionPct !== null ? `${commissionPct}%` : (rank !== null ? `#${rank}` : '—')}
              </span>
            </Card>
          </div>
        </div>

        {/* Recent orders */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-[14px]">
            <span style={{ fontSize: 17, fontWeight: 700, color: M.ink }}>Последние заказы</span>
            <Link to="/seller/orders" style={{ fontSize: 13.5, fontWeight: 600, color: M.indigo }}>Все заказы →</Link>
          </div>
          <Card style={{ borderRadius: 18, overflow: 'hidden' }}>
            <div
              className="grid"
              style={{ gridTemplateColumns: '110px 1.3fr 1fr 1fr 130px 120px', padding: '13px 22px', fontSize: 11.5, fontWeight: 700, color: M.muted, letterSpacing: '.03em', textTransform: 'uppercase', borderBottom: `1px solid ${M.bg}` }}
            >
              <div>Номер</div><div>Клиент</div><div>Город</div><div>Время</div><div>Статус</div><div className="text-right">Сумма</div>
            </div>
            {isLoading ? (
              <div className="p-5 space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-xl bg-slate-100 animate-pulse" />)}
              </div>
            ) : recent.length === 0 ? (
              <div className="p-10 text-center">
                <p style={{ fontSize: 13, color: M.muted, marginBottom: 14 }}>Заказов нет. Создайте первый!</p>
                <Link to="/seller/orders/create" className="inline-block">
                  <PrimaryButton as="span" style={{ pointerEvents: 'none' }}>Создать заказ</PrimaryButton>
                </Link>
              </div>
            ) : recent.map((order, i) => (
              <div
                key={order.id}
                className="grid items-center cursor-pointer hover:bg-slate-50/60 transition-colors"
                style={{ gridTemplateColumns: '110px 1.3fr 1fr 1fr 130px 120px', padding: '16px 22px', borderBottom: i < recent.length - 1 ? `1px solid ${M.bg}` : 'none' }}
                onClick={() => setDetailOrder(order)}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: M.faint, fontVariantNumeric: 'tabular-nums' }}>
                  {order.order_number ?? order.id?.slice(0, 8)}
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: M.ink }} className="truncate pr-2">
                  {order.customer?.full_name ?? '—'}
                </div>
                <div style={{ fontSize: 13, color: '#76766E', fontWeight: 500 }}>{citiesById[order.city_id] ?? '—'}</div>
                <div style={{ fontSize: 13, color: M.muted, fontWeight: 500 }}>{fmtDate(order.created_at)}</div>
                <div><StatusPill status={order.status} /></div>
                <div className="text-right" style={{ fontSize: 15, fontWeight: 800, color: M.ink, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtAmount(order.total_order_amount ?? order.total_amount)} с
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MOBILE LAYOUT  (below lg) — Seller Panel Redesign
      ═══════════════════════════════════════════════════════════ */}
      <MobileShell>
        <div className="px-[18px]">
          {/* Greeting */}
          <div className="flex items-center justify-between" style={{ padding: '8px 4px 16px' }}>
            <div>
              <div style={{ fontSize: 13, color: M.sub, fontWeight: 500 }}>Добрый день,</div>
              <div style={{ fontSize: 21, fontWeight: 700, color: M.ink, letterSpacing: '-.01em', marginTop: 1 }}>
                {firstName ?? '—'}
              </div>
            </div>
            <InitialsAvatar name={me?.full_name ?? ''} size={42} radius={14} />
          </div>

          {/* Earnings money card */}
          <DarkCard style={{ padding: '22px 22px 20px' }}>
            <div className="flex items-center gap-[7px]">
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34D399' }} />
              <span style={{ fontSize: 12.5, color: M.darkSub, fontWeight: 600, letterSpacing: '.02em' }}>Заработано сегодня</span>
            </div>
            <div style={{ fontSize: 42, fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1, marginTop: 12 }}>
              {isLoading ? '—' : fmtAmount(stats.todayEarnings)}{' '}
              <span style={{ fontSize: 24, fontWeight: 600, color: M.darkMuted }}>с</span>
            </div>
            <div style={{ fontSize: 12.5, color: M.darkMuted, marginTop: 9, fontWeight: 500 }}>
              {isLoading ? 'Загрузка…' : `${stats.todayCount} заказов сегодня · ${stats.deliveredCount} доставлено`}
            </div>
            <Link to="/seller/orders/create" style={{ display: 'inline-block', marginTop: 18 }}>
              <PrimaryButton as="span" style={{ pointerEvents: 'none' }}>
                <Plus size={17} strokeWidth={2.4} />
                Новый заказ
              </PrimaryButton>
            </Link>
          </DarkCard>

          {/* Stat tiles */}
          <div className="grid grid-cols-3 gap-[9px] mt-[14px]">
            <StatTile value={isLoading ? '—' : String(stats.activeCount)} label="В работе" to="/seller/orders" state={{ statusFilter: 'confirmed' }} />
            <StatTile value={isLoading ? '—' : String(stats.deliveredCount)} label="Доставлено" to="/seller/orders" state={{ statusFilter: 'delivered' }} />
            {commissionPct !== null
              ? <StatTile value={`${commissionPct}%`} label="Мой процент" valueColor={M.green} />
              : <StatTile value={rank !== null ? `#${rank}` : '—'} label="В команде" />}
          </div>

        </div>
      </MobileShell>

      {/* Bottom sheet — works on both mobile and desktop dashboard */}
      <OrderDetailBottomSheet order={detailOrder} onClose={() => setDetailOrder(null)} citiesById={citiesById} />
    </>
  )
}
