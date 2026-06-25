/**
 * CourierProfilePage — /owner/logistics/couriers/:id
 *
 * Tabs:
 *   0. Обзор    — KPI cards + performance chart
 *   1. Заказы   — paginated order history
 *   2. Передачи — cash handover history for this courier
 */
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, Activity, ChevronRight, BarChart2, ShoppingBag, Banknote } from 'lucide-react'

import Badge from '../../../shared/components/Badge'
import Alert from '../../../shared/components/Alert'
import { useLogisticsCourier, useCourierOrders, useCourierPerformance } from '../hooks/useLogisticsCourier'
import { useHandovers } from '../hooks/useHandovers'
import CourierPerformanceChart from '../components/CourierPerformanceChart'
import CourierOrdersTable      from '../components/CourierOrdersTable'
import CashHandoversPage       from '../components/CashHandoversPage'

const fmtMoney = (n) =>
  Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const fmtNum = (n) =>
  Number(n ?? 0).toLocaleString('ru-RU')

const fmtMin = (n) => {
  if (!n || n === 0) return '—'
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return h > 0 ? `${h}ч ${m}м` : `${m}м`
}

const fmtPct = (n) =>
  Number(n ?? 0).toFixed(1) + '%'

const STATUS_CFG = {
  free:     { label: 'Свободен',  badge: 'emerald' },
  busy:     { label: 'Занят',     badge: 'amber'   },
  inactive: { label: 'Неактивен', badge: 'slate'   },
}

const TABS = [
  { id: 'overview',  label: 'Обзор',    icon: Activity     },
  { id: 'orders',    label: 'Заказы',   icon: ShoppingBag  },
  { id: 'handovers', label: 'Передачи', icon: Banknote     },
]

// Date range presets for performance chart
const PRESETS = [
  { label: '7д',  days: 7   },
  { label: '14д', days: 14  },
  { label: '30д', days: 30  },
  { label: '90д', days: 90  },
]

function addDays(d, n) {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toISO(d) {
  return d.toISOString().split('T')[0]
}

function defaultRange(days = 14) {
  const to   = new Date()
  const from = addDays(to, -days)
  return { from: toISO(from), to: toISO(to) }
}

export default function CourierProfilePage() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [tab, setTab] = useState('overview')
  const [presetDays, setPresetDays] = useState(14)
  const [range, setRange] = useState(() => defaultRange(14))
  const [ordersPage, setOrdersPage] = useState(1)
  const [ordersFilter, setOrdersFilter] = useState({ limit: 20, page: 1 })

  const {
    data: courier,
    isLoading: courierLoading,
    isError: courierError,
    error: courierErr,
  } = useLogisticsCourier(id)

  const {
    data: perfData = [],
    isLoading: perfLoading,
  } = useCourierPerformance(id, { from: range.from, to: range.to })

  const {
    data: ordersData,
    isLoading: ordersLoading,
  } = useCourierOrders(id, ordersFilter)

  function selectPreset(days) {
    setPresetDays(days)
    setRange(defaultRange(days))
  }

  function handleOrderPage(p) {
    setOrdersPage(p)
    setOrdersFilter(f => ({ ...f, page: p }))
  }

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (courierLoading) {
    return (
      <div className="p-4 md:p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="skeleton w-9 h-9 rounded-xl" />
          <div className="skeleton w-40 h-6 rounded-full" />
        </div>
        <div className="card p-5 space-y-4">
          <div className="skeleton w-48 h-7 rounded-full" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1,2,3,4].map(i => <div key={i} className="skeleton w-full h-20 rounded-2xl" />)}
          </div>
        </div>
      </div>
    )
  }

  if (courierError) {
    return (
      <div className="p-4 md:p-6">
        <Alert variant="error">
          {courierErr?.response?.data?.error?.message ?? 'Ошибка загрузки профиля курьера'}
        </Alert>
      </div>
    )
  }

  const sc = courier ? (STATUS_CFG[courier.status] ?? STATUS_CFG.inactive) : STATUS_CFG.inactive

  const kpis = courier ? [
    { label: 'Всего доставлено',   value: fmtNum(courier.total_delivered),           color: 'text-emerald-700' },
    { label: 'Процент успеха',     value: fmtPct(courier.success_rate),              color: Number(courier.success_rate) >= 90 ? 'text-emerald-700' : Number(courier.success_rate) >= 70 ? 'text-amber-600' : 'text-rose-600' },
    { label: 'Ср. время доставки', value: fmtMin(courier.avg_delivery_minutes),      color: 'text-slate-700' },
    { label: 'Активных заказов',   value: fmtNum(courier.active_orders),             color: courier.active_orders > 0 ? 'text-indigo-700' : 'text-slate-400' },
    { label: 'Долг (наличные)',    value: `${fmtMoney(courier.cash_debt)} сом`,      color: courier.cash_debt > 0 ? 'text-rose-600' : 'text-slate-400' },
    { label: 'Передано всего',     value: `${fmtMoney(courier.total_handed_over)} сом`, color: 'text-slate-700' },
    { label: 'Заработано',         value: `${fmtMoney(courier.earnings)} сом`,       color: 'text-indigo-600' },
    { label: 'Неудачных доставок', value: fmtNum(courier.total_failed),              color: courier.total_failed > 0 ? 'text-rose-500' : 'text-slate-400' },
  ] : []

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* ── Back + breadcrumb ───────────────────────────────────────────── */}
      <button
        onClick={() => navigate('/owner/logistics')}
        className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 transition-colors group"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
        Логистика
        <ChevronRight size={13} className="text-slate-300" />
        <span className="text-slate-800 font-medium">Курьер</span>
      </button>

      {/* ── Profile header ─────────────────────────────────────────────── */}
      {courier && (
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Avatar */}
            <div className="w-14 h-14 rounded-2xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <span className="text-xl font-black text-indigo-600">
                {courier.full_name?.charAt(0)?.toUpperCase() ?? '?'}
              </span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-slate-900">{courier.full_name}</h1>
                <Badge variant={sc.badge}>{sc.label}</Badge>
                {!courier.is_active && (
                  <Badge variant="slate">Деактивирован</Badge>
                )}
              </div>
              {courier.phone && (
                <a
                  href={`tel:${courier.phone}`}
                  className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 transition-colors"
                >
                  <Phone size={13} />
                  {courier.phone}
                </a>
              )}
            </div>

            {/* Active orders chip */}
            {courier.active_orders > 0 && (
              <div className="flex-shrink-0 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2 text-center">
                <p className="text-2xl font-black text-amber-700">{courier.active_orders}</p>
                <p className="text-[11px] text-amber-600 font-medium">активных заказов</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl w-fit">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={[
                'flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150',
                active
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              ].join(' ')}
            >
              <Icon size={15} />
              <span className="hidden sm:inline">{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── Tab: Overview ──────────────────────────────────────────────── */}
      {tab === 'overview' && courier && (
        <div className="space-y-5 animate-fade-in">

          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {kpis.map(k => (
              <div key={k.label} className="card p-4">
                <p className={`text-2xl font-black ${k.color}`}>{k.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">{k.label}</p>
              </div>
            ))}
          </div>

          {/* Performance chart with date range selector */}
          <div>
            {/* Preset buttons */}
            <div className="flex items-center gap-2 mb-3">
              <BarChart2 size={14} className="text-slate-400" />
              <span className="text-xs font-semibold text-slate-700">Период:</span>
              <div className="flex gap-1">
                {PRESETS.map(p => (
                  <button
                    key={p.days}
                    onClick={() => selectPreset(p.days)}
                    className={[
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                      presetDays === p.days
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    ].join(' ')}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <CourierPerformanceChart data={perfData} loading={perfLoading} />
          </div>
        </div>
      )}

      {/* ── Tab: Orders ────────────────────────────────────────────────── */}
      {tab === 'orders' && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-slate-800">История заказов</p>
            {ordersData?.meta && (
              <p className="text-xs text-slate-400">
                Всего: {ordersData.meta.total}
              </p>
            )}
          </div>
          <CourierOrdersTable
            data={ordersData}
            loading={ordersLoading}
            page={ordersPage}
            onPage={handleOrderPage}
          />
        </div>
      )}

      {/* ── Tab: Handovers ─────────────────────────────────────────────── */}
      {tab === 'handovers' && (
        <div className="animate-fade-in">
          <CashHandoversPage courierId={id} />
        </div>
      )}
    </div>
  )
}
