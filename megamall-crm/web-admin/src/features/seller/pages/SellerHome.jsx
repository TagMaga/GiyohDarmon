import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Phone, Wallet, Clock, ShoppingCart, CheckCircle } from 'lucide-react'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import KpiCard from '../../../shared/components/KpiCard'
import useSellerOrders from '../hooks/useSellerOrders'
import { useSellerCompensation, useSellerTeamRank, useSellerMe } from '../hooks/useSellerMe'
import OrderDetailBottomSheet from '../components/OrderDetailBottomSheet'
import SellerOrdersTable from '../components/SellerOrdersTable'
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
  const commissionPct = compensation?.commission_percent ?? null
  const rank = rankData?.rank ?? null
  const recent = orders.slice(0, 5)
  const firstName = me?.full_name?.split(' ')[0] ?? null

  return (
    <>
      {/* ═══════════════════════════════════════════════════════════
          DESKTOP LAYOUT  (lg and up)
      ═══════════════════════════════════════════════════════════ */}
      <div className="hidden lg:block p-6">

        {/* Greeting header */}
        <div className="flex items-center justify-between mb-7">
          <div>
            <h1 className="page-title">
              {firstName ? `Добрый день, ${firstName}!` : 'Добрый день!'}
            </h1>
            <p className="page-subtitle">
              {isLoading
                ? 'Загрузка данных…'
                : `${stats.todayCount} заказов сегодня · ${fmtAmount(stats.todayEarnings)} заработано`}
            </p>
          </div>
        </div>

        {/* 4 KPI cards */}
        <div className="grid grid-cols-4 gap-5 mb-7">
          <KpiCard
            label="Заказов сегодня"
            value={isLoading ? '—' : String(stats.todayCount)}
            icon={<ShoppingCart size={20} />}
            color="sky"
            loading={isLoading}
          />
          <KpiCard
            label="В работе"
            value={isLoading ? '—' : String(stats.activeCount)}
            icon={<Clock size={20} />}
            color="amber"
            loading={isLoading}
          />
          <KpiCard
            label="Доставлено"
            value={isLoading ? '—' : String(stats.deliveredCount)}
            icon={<CheckCircle size={20} />}
            color="emerald"
            loading={isLoading}
          />
          <KpiCard
            label="Заработано сегодня"
            value={isLoading ? '—' : fmtAmount(stats.todayEarnings)}
            icon={<Wallet size={20} />}
            color="violet"
            loading={isLoading}
          />
        </div>

        {/* Recent orders table */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">Последние заказы</h2>
            <Link
              to="/seller/orders"
              className="text-sm text-indigo-600 hover:text-indigo-700 font-semibold"
            >
              Все заказы →
            </Link>
          </div>
          <SellerOrdersTable
            orders={recent}
            loading={isLoading}
            citiesById={citiesById}
            onDetail={setDetailOrder}
          />
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
            <StatTile value={isLoading ? '—' : String(stats.activeCount)} label="В работе" />
            <StatTile value={isLoading ? '—' : String(stats.deliveredCount)} label="Доставлено" />
            {commissionPct !== null
              ? <StatTile value={`${commissionPct}%`} label="Мой процент" valueColor={M.green} />
              : <StatTile value={rank !== null ? `#${rank}` : '—'} label="В команде" />}
          </div>

          {/* Recent orders */}
          <div className="flex items-center justify-between" style={{ margin: '22px 4px 12px' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: M.ink }}>Последние заказы</span>
            <Link to="/seller/orders" style={{ fontSize: 13, fontWeight: 600, color: M.indigo }}>
              Все →
            </Link>
          </div>

          {isLoading ? (
            <div className="space-y-[10px]">
              {[1, 2, 3].map(i => <Card key={i} className="h-[104px] animate-pulse" />)}
            </div>
          ) : recent.length === 0 ? (
            <Card className="p-8 text-center">
              <p style={{ fontSize: 13, color: M.muted, marginBottom: 14 }}>Заказов нет. Создайте первый!</p>
              <Link to="/seller/orders/create" className="inline-block">
                <PrimaryButton as="span" style={{ pointerEvents: 'none' }}>Создать заказ</PrimaryButton>
              </Link>
            </Card>
          ) : (
            <div className="space-y-[10px]">
              {recent.map(order => (
                <RecentCard
                  key={order.id}
                  order={order}
                  cityName={citiesById[order.city_id]}
                  onDetail={() => setDetailOrder(order)}
                />
              ))}
            </div>
          )}
        </div>
      </MobileShell>

      {/* Bottom sheet — works on both mobile and desktop dashboard */}
      <OrderDetailBottomSheet order={detailOrder} onClose={() => setDetailOrder(null)} citiesById={citiesById} />
    </>
  )
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function RecentCard({ order, cityName, onDetail }) {
  return (
    <Card className="p-[15px] active:scale-[0.99] transition-transform" onClick={onDetail}>
      <div className="flex items-start justify-between gap-[10px]">
        <div className="min-w-0">
          <p style={{ fontSize: 11, fontWeight: 700, color: M.faint, letterSpacing: '.03em', fontVariantNumeric: 'tabular-nums' }}>
            {order.order_number ?? order.id?.slice(0, 8)}
          </p>
          <p className="truncate" style={{ fontSize: 15, fontWeight: 700, color: M.ink, marginTop: 3 }}>
            {order.customer?.full_name ?? '—'}
          </p>
          <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
            {cityName && (
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#76766E', background: '#F0EFEA', padding: '2px 8px', borderRadius: 7 }}>
                {cityName}
              </span>
            )}
            <span style={{ fontSize: 11.5, color: M.muted, fontWeight: 500 }}>{fmtDate(order.created_at)}</span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <StatusPill status={order.status} />
          <div style={{ fontSize: 16, fontWeight: 800, color: M.ink, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
            {fmtAmount(order.total_order_amount ?? order.total_amount)} с
          </div>
        </div>
      </div>

      <div className="flex gap-2" style={{ marginTop: 13 }}>
        {order.customer?.phone && (
          <a
            href={`tel:${order.customer.phone}`}
            onClick={e => e.stopPropagation()}
            className="flex-1 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
            style={{ background: '#EAF6EF', color: M.green, fontSize: 13, fontWeight: 700, padding: 10, borderRadius: 11, minHeight: 40 }}
          >
            <Phone size={14} />
            Позвонить
          </a>
        )}
        <button
          onClick={e => { e.stopPropagation(); onDetail() }}
          className="flex-1 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
          style={{ background: '#EEEDFB', color: M.indigoDeep, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: 10, borderRadius: 11, minHeight: 40, cursor: 'pointer' }}
        >
          Детали →
        </button>
      </div>
    </Card>
  )
}
