import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Plus, Phone, ChevronRight, TrendingUp, Percent, Trophy, Wallet, Clock, ShoppingCart, Package, CheckCircle } from 'lucide-react'
import { fmtAmount, fmtDate, STATUS_LABELS, STATUS_BADGE } from '../../../shared/orderStatusConfig'
import Badge from '../../../shared/components/Badge'
import KpiCard from '../../../shared/components/KpiCard'
import useSellerOrders from '../hooks/useSellerOrders'
import useSellerPayouts from '../hooks/useSellerPayouts'
import { useSellerCompensation, useSellerTeamRank, useSellerMe } from '../hooks/useSellerMe'
import useMyIncome from '../../hr/hooks/useMyIncome'
import OrderDetailBottomSheet from '../components/OrderDetailBottomSheet'
import SellerOrdersTable from '../components/SellerOrdersTable'
import { fetchCities } from '../api'
import { KEYS } from '../../../shared/queryKeys'

function toDateStr(d) { return d.toISOString().slice(0, 10) }

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
  const { data: payouts = [] } = useSellerPayouts()
  const { data: compensation } = useSellerCompensation()
  const { data: rankData } = useSellerTeamRank()
  const { data: me } = useSellerMe()
  const { data: cities = [] } = useQuery({ queryKey: KEYS.seller.cities, queryFn: fetchCities, staleTime: 10 * 60 * 1000 })

  const now = new Date()
  const { data: incomeReport } = useMyIncome({
    from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: toDateStr(now),
  })

  const citiesById = useMemo(() => Object.fromEntries(cities.map(c => [c.id, c.name])), [cities])
  const stats = useMemo(() => calcStats(orders), [orders])
  const pendingPayout = useMemo(
    () => payouts.filter(p => p.status === 'pending').reduce((s, p) => s + (p.amount ?? 0), 0),
    [payouts]
  )
  const commissionPct = compensation?.commission_percent ?? null
  const rank = rankData?.rank ?? null
  const monthIncome = incomeReport?.total_income ?? 0
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
          MOBILE LAYOUT  (below lg)
      ═══════════════════════════════════════════════════════════ */}
      <div className="lg:hidden min-h-screen" style={{ background: '#F2F4F7' }}>
        {/* Hero */}
        <div
          className="relative overflow-hidden px-[10px] pb-8"
          style={{
            background: 'linear-gradient(135deg, #4F46E5 0%, #6D28D9 100%)',
            borderRadius: '0 0 32px 32px',
            boxShadow: '0 8px 32px rgba(79,70,229,0.35)',
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 40px)',
            margin: '0 10px',
          }}
        >
          <div className="absolute top-0 right-0 w-56 h-56 rounded-full bg-white/5 -translate-y-20 translate-x-20" />
          <div className="absolute bottom-0 left-8 w-28 h-28 rounded-full bg-white/5 translate-y-10" />
          <div className="relative z-10">
            <p className="text-sm font-medium text-indigo-200">Сегодня заработано</p>
            <p className="text-[42px] font-black text-white tracking-tight leading-none mt-1">
              {isLoading ? '—' : fmtAmount(stats.todayEarnings)}
            </p>
            <p className="text-xs text-indigo-300 mt-2">По доставленным заказам · {stats.todayCount} заказ(ов) за день</p>
            <Link
              to="/seller/orders/create"
              className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-indigo-700 text-sm font-bold active:scale-95 transition-transform"
              style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}
            >
              <Plus size={15} />
              Новый заказ
            </Link>
          </div>
        </div>

        <div className="pb-28 space-y-5" style={{ padding: '10px', paddingBottom: '7rem' }}>
          {/* Info strip */}
          <div className="grid grid-cols-2 gap-3">
            {commissionPct !== null && (
              <InfoChip icon={<Percent size={15} className="text-indigo-600" />} label="Мой процент" value={`${commissionPct}%`} />
            )}
            {rank !== null && (
              <InfoChip icon={<Trophy size={15} className="text-amber-500" />} label="Рейтинг" value={`#${rank} в команде`} compact />
            )}
            <InfoChip icon={<TrendingUp size={15} className="text-emerald-600" />} label="Доход (месяц)" value={fmtAmount(monthIncome)} />
            {pendingPayout > 0 && (
              <InfoChip icon={<Clock size={15} className="text-orange-500" />} label="Ожидает выплаты" value={fmtAmount(pendingPayout)} accent />
            )}
          </div>

          {/* Recent orders */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-800">Последние заказы</h2>
              <Link to="/seller/orders" className="text-xs text-indigo-600 font-semibold flex items-center gap-0.5">
                Все заказы <ChevronRight size={13} />
              </Link>
            </div>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="card h-[104px] animate-pulse" />)}
              </div>
            ) : recent.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-sm text-slate-400 mb-4">Заказов нет. Создайте первый!</p>
                <Link to="/seller/orders/create" className="btn btn-primary btn-md">Создать заказ</Link>
              </div>
            ) : (
              <div className="space-y-3">
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
        </div>
      </div>

      {/* Bottom sheet — works on both mobile and desktop dashboard */}
      <OrderDetailBottomSheet order={detailOrder} onClose={() => setDetailOrder(null)} citiesById={citiesById} />
    </>
  )
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function StatCard({ label, value, bg, color, loading }) {
  return (
    <div
      className="rounded-[20px] p-4"
      style={{ background: bg, boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)' }}
    >
      {loading
        ? <div className="h-8 w-16 bg-white/50 rounded-lg animate-pulse mb-2" />
        : <p className="text-3xl font-black" style={{ color }}>{value}</p>
      }
      <p className="text-xs font-medium text-slate-500 mt-1">{label}</p>
    </div>
  )
}

function InfoChip({ icon, label, value, accent, compact }) {
  return (
    <div
      className="card p-3 flex items-center gap-2"
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)' }}
    >
      <div className="w-7 h-7 rounded-xl bg-slate-50 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider leading-none">{label}</p>
        <p className={`${compact ? 'text-xs' : 'text-sm'} font-bold mt-0.5 ${accent ? 'text-orange-600' : 'text-slate-900'} leading-tight`}>
          {value}
        </p>
      </div>
    </div>
  )
}

function RecentCard({ order, cityName, onDetail }) {
  return (
    <div
      className="card p-4 active:scale-[0.99] transition-transform"
      style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-bold text-slate-400">
            {order.order_number ?? order.id?.slice(0, 8)}
          </p>
          <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate">
            {order.customer?.full_name ?? '—'}
          </p>
          {order.customer?.phone && (
            <p className="text-xs text-slate-400 mt-0.5">{order.customer.phone}</p>
          )}
        </div>
        <Badge variant={STATUS_BADGE[order.status] ?? 'slate'} dot>
          {STATUS_LABELS[order.status] ?? order.status}
        </Badge>
      </div>

      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
            {cityName && <span className="bg-slate-100 px-2 py-0.5 rounded-full font-medium flex-shrink-0">{cityName}</span>}
            <span className="flex-shrink-0">{fmtDate(order.created_at)}</span>
          </div>
          {order.delivery_address && (
            <p className="text-xs text-slate-500 truncate">{order.delivery_address}</p>
          )}
        </div>
        <span className="text-sm font-bold text-slate-900">
          {fmtAmount(order.total_order_amount ?? order.total_amount)}
        </span>
      </div>

      <div className="flex gap-2">
        {order.customer?.phone && (
          <a
            href={`tel:${order.customer.phone}`}
            onClick={e => e.stopPropagation()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-semibold min-h-[40px] active:scale-95 transition-transform"
          >
            <Phone size={13} />
            Позвонить
          </a>
        )}
        <button
          onClick={onDetail}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-semibold min-h-[40px] active:scale-95 transition-transform"
        >
          <ChevronRight size={13} />
          Детали
        </button>
      </div>
    </div>
  )
}
