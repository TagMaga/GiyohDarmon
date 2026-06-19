/**
 * OwnerDashboard — Phase 5D Executive CEO Dashboard
 *
 * 10 blocks, real data only. No mocks. No fake charts.
 * Backend APIs used:
 *   GET /finance/summary?from=&to=   — KPIs, profit waterfall
 *   GET /finance/daily?from=&to=     — trend chart (Phase 5D)
 *   GET /finance/sellers?from=&to=   — seller leaderboard (Phase 5D)
 *   GET /finance/teams?from=&to=     — team ranking (Phase 5D)
 *   GET /orders/stats?from=&to=      — business health
 *   GET /owner/logistics/dashboard   — logistics snapshot
 *   GET /finance/cash?limit=5        — handovers
 *   GET /orders?status=…&limit=1     — alert counters
 *   GET /inventory                   — warehouse risks
 */

import { useMemo, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  RefreshCw, ArrowRight, Banknote, Truck,
  PackageX, UserPlus, Settings2, PlusCircle,
  ChevronRight, TrendingUp, TrendingDown, ShoppingCart,
  BarChart2, Wallet, Package, ShoppingBag, Activity,
  AlertTriangle, Users, Trophy, Zap, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'

import KpiCard              from '../shared/components/KpiCard'
import useFinanceSummary    from '../features/finance/hooks/useFinanceSummary'
import useFinanceCash       from '../features/finance/hooks/useFinanceCash'
import useLogisticsDashboard from '../features/logistics/hooks/useLogisticsDashboard'
import useOrderStats        from '../features/owner/hooks/useOrderStats'
import useOwnerOrders       from '../features/orders/hooks/useOwnerOrders'
import useInventory         from '../features/warehouse/hooks/useInventory'
import useFinanceDaily      from '../features/owner/hooks/useFinanceDaily'
import useSellerLeaderboard from '../features/owner/hooks/useSellerLeaderboard'
import useTeamPerformance   from '../features/owner/hooks/useTeamPerformance'
import { getStockStatus }   from '../features/warehouse/utils/warehouseHelpers'

// ── Date helpers ──────────────────────────────────────────────────────────────
function toYMD(d) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

const PERIODS = [
  { key: 'today',     label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: '7d',        label: '7 дней' },
  { key: '30d',       label: '30 дней' },
  { key: 'month',     label: 'Месяц' },
  { key: 'all',       label: 'Всё время' },
]

function periodRange(key) {
  const now   = new Date()
  const minus = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }
  switch (key) {
    case 'today':     return { from: toYMD(now), to: toYMD(now) }
    case 'yesterday': { const y = minus(1); return { from: toYMD(y), to: toYMD(y) } }
    case '7d':        return { from: toYMD(minus(6)),  to: toYMD(now) }
    case '30d':       return { from: toYMD(minus(29)), to: toYMD(now) }
    case 'month':     return { from: toYMD(new Date(now.getFullYear(), now.getMonth(), 1)), to: toYMD(now) }
    default:          return {}
  }
}

function previousPeriodRange(key) {
  const now   = new Date()
  const minus = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }
  switch (key) {
    case 'today':     { const y = minus(1); return { from: toYMD(y), to: toYMD(y) } }
    case 'yesterday': { const d = minus(2); return { from: toYMD(d), to: toYMD(d) } }
    case '7d':        return { from: toYMD(minus(13)), to: toYMD(minus(7)) }
    case '30d':       return { from: toYMD(minus(59)), to: toYMD(minus(30)) }
    case 'month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toYMD(s), to: toYMD(e) }
    }
    default: return null
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtMoney = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
const fmtNum   = (v) => Number(v || 0).toLocaleString('ru-RU')
const fmtPct   = (v) => v != null ? `${v.toFixed(1)}%` : '—'

// ── Primitives ────────────────────────────────────────────────────────────────

function SectionLabel({ children, icon: Icon }) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={12} className="text-slate-400" />}
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{children}</p>
    </div>
  )
}

function Card({ title, titleIcon: TitleIcon, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-100 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-50">
          <div className="flex items-center gap-2">
            {TitleIcon && (
              <span className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                <TitleIcon size={13} className="text-slate-500" />
              </span>
            )}
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

function LinkBtn({ onClick, children }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors">
      {children} <ChevronRight size={13} />
    </button>
  )
}

// ── BLOCK 1 — Hero KPI ────────────────────────────────────────────────────────

function HeroKpi({ value, prevValue, loading, label }) {
  const delta     = prevValue != null ? value - prevValue : null
  const deltaPct  = (prevValue != null && prevValue !== 0) ? (delta / Math.abs(prevValue)) * 100 : null
  const isUp      = delta !== null && delta >= 0
  const hasChange = delta !== null

  return (
    <div className="rounded-3xl border border-slate-100 bg-white shadow-sm px-7 py-6 flex flex-col gap-1">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      {loading ? (
        <div className="h-14 w-56 bg-slate-100 rounded-2xl animate-pulse mt-2" />
      ) : (
        <p className="text-[52px] font-bold leading-none tracking-tight text-slate-900 tabular-nums mt-1">
          {fmtMoney(value)}{' '}
          <span className="text-[28px] font-semibold text-slate-400">с</span>
        </p>
      )}
      {hasChange && !loading && (
        <div className={`flex items-center gap-1.5 mt-1 ${isUp ? 'text-emerald-600' : 'text-rose-500'}`}>
          {isUp ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          <span className="text-[13px] font-semibold tabular-nums">
            {isUp ? '+' : ''}{fmtMoney(delta)} с
          </span>
          {deltaPct !== null && (
            <span className="text-[12px] font-medium opacity-80">
              ({isUp ? '+' : ''}{deltaPct.toFixed(1)}% vs. предыдущий период)
            </span>
          )}
        </div>
      )}
      {!hasChange && !loading && (
        <p className="text-xs text-slate-400 mt-1">Нет данных для сравнения</p>
      )}
    </div>
  )
}

// ── BLOCK 2 — Trend chart ─────────────────────────────────────────────────────

const CHART_TABS = [
  { key: 'revenue', label: 'Выручка',   color: '#6366f1', field: 'total_sales' },
  { key: 'profit',  label: 'Прибыль компании', color: '#10b981', field: 'company_revenue' },
]

function TrendChart({ data = [], loading }) {
  const [tab, setTab] = useState('revenue')
  const cfg = CHART_TABS.find(t => t.key === tab)

  const formatted = useMemo(() => data.map(d => ({
    ...d,
    label: d.date ? d.date.slice(5) : '', // MM-DD
  })), [data])

  if (loading) {
    return (
      <Card title="Динамика" titleIcon={BarChart2}>
        <div className="px-5 pb-5 pt-3 h-52 bg-slate-50 rounded-b-2xl animate-pulse" />
      </Card>
    )
  }

  if (data.length === 0) {
    return (
      <Card title="Динамика" titleIcon={BarChart2}>
        <div className="px-5 pb-8 pt-5 text-center text-sm text-slate-400">
          Нет данных для выбранного периода
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Динамика"
      titleIcon={BarChart2}
      action={
        <div className="flex gap-1">
          {CHART_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                tab === t.key
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="px-2 pb-4 pt-2">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={formatted} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={cfg.color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}к` : v}
              width={36}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
              formatter={(v) => [`${fmtMoney(v)} с`, cfg.label]}
              labelFormatter={(l) => `Дата: ${l}`}
            />
            <Area
              type="monotone"
              dataKey={cfg.field}
              stroke={cfg.color}
              strokeWidth={2}
              fill="url(#chartGrad)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: cfg.color }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

// ── BLOCK 3 — Business health ─────────────────────────────────────────────────

function BusinessHealth({ stats, logi, loading, onNav }) {
  const by = stats?.by_status ?? {}
  const delivered  = by.delivered   ?? 0
  const inDelivery = by.in_delivery ?? 0
  const cancelled  = by.cancelled   ?? 0
  const failed     = by.failed      ?? 0
  const total      = stats?.total   ?? 0
  const successRate = total > 0 ? ((delivered / total) * 100).toFixed(0) : null

  const items = [
    { label: 'Заказов за период',      value: fmtNum(total),                dot: 'bg-slate-400'   },
    { label: 'Доставлено',             value: fmtNum(delivered),             dot: 'bg-emerald-500' },
    { label: 'В доставке сейчас',      value: fmtNum(inDelivery),            dot: 'bg-violet-400'  },
    { label: 'Отменено',               value: fmtNum(cancelled),             dot: 'bg-slate-300'   },
    { label: 'Неуспешных доставок',    value: fmtNum(failed),                dot: 'bg-rose-500'    },
    { label: 'Без курьера',            value: fmtNum(stats?.unassigned ?? 0),dot: 'bg-orange-400'  },
    { label: 'Сред. время доставки',   value: logi?.avg_delivery_minutes > 0 ? `${Math.round(logi.avg_delivery_minutes)} мин` : '—', dot: 'bg-sky-400' },
    { label: 'Успешность',             value: successRate ? `${successRate}%` : '—', dot: successRate >= 80 ? 'bg-emerald-500' : 'bg-amber-400' },
  ]

  return (
    <Card
      title="Операционное здоровье"
      titleIcon={Activity}
      action={<LinkBtn onClick={() => onNav('/owner/orders')}>Все заказы</LinkBtn>}
    >
      <div className="px-5 pb-5 pt-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-8 bg-slate-50 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-0">
            {items.map((it) => (
              <div key={it.label} className="flex items-center gap-2.5 py-2 border-b border-slate-50 last:border-0">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${it.dot}`} />
                <span className="text-xs text-slate-500 flex-1 truncate">{it.label}</span>
                <span className="text-sm font-semibold text-slate-900 tabular-nums">{it.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── BLOCK 4 — Attention center ────────────────────────────────────────────────

function AttentionCenter({ items, loading, onNav }) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm px-5 py-4 space-y-2">
        {[...Array(3)].map((_, i) => <div key={i} className="h-9 bg-slate-50 rounded-xl animate-pulse" />)}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-3.5 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
        <p className="text-sm font-medium text-emerald-800">Всё в порядке — нет требующих внимания пунктов</p>
      </div>
    )
  }
  return (
    <Card title="Требует внимания" titleIcon={AlertTriangle}>
      <div className="divide-y divide-slate-50">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => onNav(it.to)}
            className="w-full px-5 py-3 flex items-center gap-3 hover:bg-slate-50/60 transition-colors text-left group"
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${it.dot}`} />
            <p className="text-sm text-slate-700 flex-1 leading-snug">{it.text}</p>
            <ArrowRight size={13} className="text-slate-300 group-hover:text-indigo-500 flex-shrink-0 transition-colors" />
          </button>
        ))}
      </div>
    </Card>
  )
}

// ── BLOCK 5 — Team performance ────────────────────────────────────────────────

function TeamPerformanceBlock({ teams = [], loading, onNav }) {
  return (
    <Card
      title="Команды"
      titleIcon={Users}
      action={<LinkBtn onClick={() => onNav('/owner/teams')}>Все команды</LinkBtn>}
    >
      <div className="px-5 pb-5 pt-3">
        {loading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-50 rounded-xl animate-pulse" />)}</div>
        ) : teams.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Нет данных за период</p>
        ) : (
          <div className="space-y-0 divide-y divide-slate-50">
            {teams.map((t, i) => (
              <div key={t.team_lead_id} className="flex items-center gap-3 py-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  i === 0 ? 'bg-amber-100 text-amber-700'
                  : i === 1 ? 'bg-slate-100 text-slate-600'
                  : 'bg-slate-50 text-slate-400'
                }`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-slate-900 truncate">
                    {t.team_name || t.team_lead_name || 'Команда'}
                  </p>
                  <p className="text-[11px] text-slate-400">{fmtNum(t.orders_count)} заказов</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[13px] font-bold text-slate-900 tabular-nums">{fmtMoney(t.total_revenue)} с</p>
                  <p className="text-[11px] text-emerald-600 tabular-nums">+{fmtMoney(t.company_revenue)} с прибыль</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── BLOCK 6 — Seller leaderboard ─────────────────────────────────────────────

function SellerLeaderboard({ sellers = [], loading, onNav }) {
  return (
    <Card
      title="Топ продавцов"
      titleIcon={Trophy}
      action={<LinkBtn onClick={() => onNav('/owner/employees')}>Все сотрудники</LinkBtn>}
    >
      <div className="pb-2">
        {loading ? (
          <div className="px-5 space-y-2 pt-3">{[...Array(5)].map((_, i) => <div key={i} className="h-10 bg-slate-50 rounded-xl animate-pulse" />)}</div>
        ) : sellers.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center px-5">Нет данных за период</p>
        ) : (
          <div className="divide-y divide-slate-50">
            <div className="grid grid-cols-[32px_1fr_72px_72px] gap-2 px-5 py-2">
              <span className="text-[10px] font-semibold text-slate-400 uppercase">#</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase">Продавец</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase text-right">Выручка</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase text-right">Комиссия</span>
            </div>
            {sellers.map((s) => (
              <div key={s.seller_id} className="grid grid-cols-[32px_1fr_72px_72px] gap-2 px-5 py-2.5 items-center hover:bg-slate-50/50 transition-colors">
                <span className={`text-[12px] font-bold tabular-nums ${
                  s.rank === 1 ? 'text-amber-500'
                  : s.rank === 2 ? 'text-slate-500'
                  : s.rank === 3 ? 'text-amber-700'
                  : 'text-slate-300'
                }`}>{s.rank}</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-900 truncate">{s.full_name}</p>
                  <p className="text-[11px] text-slate-400">{fmtNum(s.orders_count)} заказов</p>
                </div>
                <p className="text-[13px] font-semibold text-slate-900 tabular-nums text-right">{fmtMoney(s.total_revenue)}</p>
                <p className="text-[13px] font-medium text-emerald-600 tabular-nums text-right">{fmtMoney(s.total_commission)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── BLOCK 7 — Logistics overview ──────────────────────────────────────────────

function LogisticsOverview({ data, loading, onNav }) {
  const d = data ?? {}

  const stats = [
    { label: 'Активных курьеров',    value: fmtNum(d.active_couriers),              accent: 'text-slate-900'  },
    { label: 'Свободных',            value: fmtNum(d.free_couriers),                accent: 'text-emerald-700'},
    { label: 'Занятых',              value: fmtNum(d.busy_couriers),                accent: 'text-indigo-700' },
    { label: 'Доставлено сегодня',   value: fmtNum(d.orders_assigned_today),         accent: 'text-slate-900'  },
    { label: 'Без курьера',          value: fmtNum(d.orders_without_courier),        accent: d.orders_without_courier > 0 ? 'text-orange-600' : 'text-slate-900' },
    { label: 'Сбоев сегодня',        value: fmtNum(d.failed_today),                 accent: d.failed_today > 0 ? 'text-rose-600' : 'text-slate-900' },
    { label: 'Сред. время',          value: d.avg_delivery_minutes > 0 ? `${Math.round(d.avg_delivery_minutes)} мин` : '—', accent: 'text-slate-900' },
    { label: 'Успешность',           value: d.success_rate > 0 ? `${d.success_rate.toFixed(0)}%` : '—', accent: 'text-emerald-700' },
    { label: 'Долг (макс. курьер)',  value: d.biggest_debt_courier?.cash_debt > 0 ? `${fmtMoney(d.biggest_debt_courier.cash_debt)} с` : '0 с', accent: d.biggest_debt_courier?.cash_debt > 0 ? 'text-amber-700' : 'text-slate-900' },
  ]

  return (
    <Card
      title="Логистика"
      titleIcon={Truck}
      action={<LinkBtn onClick={() => onNav('/owner/logistics')}>Детали</LinkBtn>}
    >
      <div className="px-5 pb-5 pt-3">
        {loading ? (
          <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-slate-50 rounded-lg animate-pulse" />)}</div>
        ) : (
          <div className="space-y-0 divide-y divide-slate-50">
            {stats.map(({ label, value, accent }) => (
              <div key={label} className="flex items-center justify-between py-2">
                <span className="text-xs text-slate-500">{label}</span>
                <span className={`text-sm font-semibold tabular-nums ${accent}`}>{value}</span>
              </div>
            ))}
            {d.biggest_debt_courier?.full_name && d.biggest_debt_courier?.cash_debt > 0 && (
              <div className="pt-2 text-[11px] text-amber-700 flex items-center gap-1">
                <Banknote size={11} />
                <span className="truncate">{d.biggest_debt_courier.full_name}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── BLOCK 8 — Financial waterfall ─────────────────────────────────────────────

function FinancialWaterfall({ summary, loading }) {
  const o = summary?.orders  ?? {}
  const r = summary?.revenue ?? {}

  const clientPaid  = Number(o.total_sales || 0) + Number(o.delivery_fees || 0)
  const sellers     = Number(r.seller_commission_earned || 0)
  const managers    = Number(r.manager_personal_commission_earned || 0) + Number(r.manager_team_commission_earned || 0)
  const teamLeads   = Number(r.team_lead_pool_earned || 0)
  const company     = Number(r.company_revenue_earned || 0)
  const couriers    = Number(r.courier_payouts || 0)
  const netProfit   = company - couriers

  const maxBar = Math.max(clientPaid, 1)
  const barW = (v) => `${Math.max(4, (Math.abs(v) / maxBar) * 100).toFixed(1)}%`

  const rows = [
    { label: 'Оплачено клиентами',   value: clientPaid, color: 'bg-indigo-500',  type: 'base' },
    { label: '− Комиссия продавцов', value: sellers,    color: 'bg-rose-400',    type: 'sub'  },
    { label: '− Комиссия менеджеров',value: managers,   color: 'bg-rose-300',    type: 'sub'  },
    { label: '− Доля тимлидов',      value: teamLeads,  color: 'bg-rose-200',    type: 'sub'  },
    { label: '= Доход компании',      value: company,    color: 'bg-emerald-500', type: 'result'},
    { label: '− Выплаты курьерам',   value: couriers,   color: 'bg-amber-400',   type: 'sub'  },
    { label: '= Чистая прибыль',      value: netProfit,  color: netProfit >= 0 ? 'bg-emerald-600' : 'bg-rose-600', type: 'final' },
  ]

  if (loading) {
    return (
      <Card title="Разбивка прибыли" titleIcon={BarChart2}>
        <div className="px-5 pb-5 pt-3 space-y-3">
          {[...Array(7)].map((_, i) => <div key={i} className="h-7 bg-slate-50 rounded-lg animate-pulse" />)}
        </div>
      </Card>
    )
  }

  return (
    <Card title="Разбивка прибыли" titleIcon={BarChart2}>
      <div className="px-5 pb-5 pt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className={`${row.type === 'result' || row.type === 'final' ? 'mt-3 pt-3 border-t border-slate-100' : ''}`}>
            <div className="flex items-center justify-between mb-1">
              <span className={`text-[12px] ${row.type === 'final' ? 'font-bold text-slate-900' : row.type === 'result' ? 'font-semibold text-slate-800' : 'text-slate-500'}`}>
                {row.label}
              </span>
              <span className={`text-[13px] tabular-nums ${row.type === 'final' ? 'font-bold' : 'font-semibold'} ${
                row.type === 'sub' ? 'text-rose-600'
                : row.type === 'final' && netProfit < 0 ? 'text-rose-600'
                : 'text-slate-900'
              }`}>
                {row.type === 'sub' ? '−' : ''}{fmtMoney(row.value)} с
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${row.color}`}
                style={{ width: barW(row.value) }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── BLOCK 9 — Warehouse risks ─────────────────────────────────────────────────

function WarehouseRisks({ inventory = [], loading, onNav }) {
  const atRisk = useMemo(() =>
    inventory
      .map(i => ({ ...i, status: getStockStatus(i) }))
      .filter(i => i.status === 'low_stock' || i.status === 'out_of_stock')
      .sort((a, b) => (a.available_quantity ?? 0) - (b.available_quantity ?? 0))
      .slice(0, 8),
    [inventory]
  )

  return (
    <Card
      title="Риски склада"
      titleIcon={Package}
      action={<LinkBtn onClick={() => onNav('/owner/warehouse')}>Склад</LinkBtn>}
    >
      <div className="px-5 pb-5 pt-3">
        {loading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-slate-50 rounded-lg animate-pulse" />)}</div>
        ) : atRisk.length === 0 ? (
          <div className="flex items-center gap-2 py-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            <p className="text-sm text-emerald-700">Остатки в норме</p>
          </div>
        ) : (
          <div className="space-y-0 divide-y divide-slate-50">
            {atRisk.map((item, i) => {
              const qty = item.available_quantity ?? item.AvailableQuantity ?? 0
              const isOut = item.status === 'out_of_stock'
              return (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isOut ? 'bg-rose-500' : 'bg-amber-400'}`} />
                  <span className="text-[13px] text-slate-700 flex-1 truncate">
                    {item.product_name ?? item.ProductName ?? `Позиция ${i + 1}`}
                  </span>
                  <span className={`text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded-full ${
                    isOut ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {qty} шт.
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── BLOCK 10 — Quick actions ──────────────────────────────────────────────────

const ACTION_CFG = {
  indigo:  { wrap: 'hover:border-indigo-200 hover:bg-indigo-50/60',   icon: 'bg-indigo-100  text-indigo-600'  },
  violet:  { wrap: 'hover:border-violet-200 hover:bg-violet-50/60',   icon: 'bg-violet-100  text-violet-600'  },
  sky:     { wrap: 'hover:border-sky-200    hover:bg-sky-50/60',      icon: 'bg-sky-100     text-sky-600'     },
  amber:   { wrap: 'hover:border-amber-200  hover:bg-amber-50/60',    icon: 'bg-amber-100   text-amber-600'   },
  emerald: { wrap: 'hover:border-emerald-200 hover:bg-emerald-50/60', icon: 'bg-emerald-100 text-emerald-600' },
  rose:    { wrap: 'hover:border-rose-200   hover:bg-rose-50/60',     icon: 'bg-rose-100    text-rose-600'    },
}

const QUICK_ACTIONS = [
  { icon: PlusCircle, label: 'Создать заказ',      to: '/owner/orders/create',      color: 'indigo'  },
  { icon: Truck,      label: 'Доска заказов',       to: '/owner/dispatch',           color: 'violet'  },
  { icon: Settings2,  label: 'Настройки доставки',  to: '/owner/settings/delivery',  color: 'sky'     },
  { icon: Banknote,   label: 'Тарифы курьеров',     to: '/owner/couriers',           color: 'amber'   },
  { icon: UserPlus,   label: 'Добавить сотрудника', to: '/owner/employees',          color: 'emerald' },
  { icon: PackageX,   label: 'Приёмка на склад',    to: '/owner/warehouse',          color: 'rose'    },
]

function QuickActions({ onNav }) {
  return (
    <Card title="Быстрые действия" titleIcon={Zap}>
      <div className="px-5 pb-5 pt-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {QUICK_ACTIONS.map((a) => {
          const cfg = ACTION_CFG[a.color]
          return (
            <button
              key={a.label}
              onClick={() => onNav(a.to)}
              className={`flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3.5 py-3 text-left transition-all group ${cfg.wrap}`}
            >
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-105 ${cfg.icon}`}>
                <a.icon size={16} />
              </span>
              <span className="text-[13px] font-medium text-slate-700 leading-tight">{a.label}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function OwnerDashboard() {
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const [period, setPeriod] = useState('month')
  const range    = useMemo(() => periodRange(period), [period])
  const prevRange = useMemo(() => previousPeriodRange(period), [period])
  const onNav    = useCallback((to) => navigate(to), [navigate])

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: summary,  isLoading: sumLoading,   isFetching: sumFetching } = useFinanceSummary(range)
  const { data: prevSum,  isLoading: prevLoading  } = useFinanceSummary(prevRange ?? {})
  const { data: stats,    isLoading: statsLoading } = useOrderStats(range)
  const { data: logi,     isLoading: logiLoading  } = useLogisticsDashboard()
  const { data: cashData, isLoading: cashLoading  } = useFinanceCash({ ...range, limit: 5 })
  const { meta: prepayMeta, isLoading: prepayLoading } = useOwnerOrders({ status: 'prepayment_pending', limit: 1 })
  const { meta: issueMeta,  isLoading: issueLoading  } = useOwnerOrders({ status: 'issue', limit: 1 })
  const { data: inventory = [], isLoading: invLoading } = useInventory()
  const { data: dailyData = [], isLoading: dailyLoading } = useFinanceDaily(range)
  const { data: sellers   = [], isLoading: sellersLoading } = useSellerLeaderboard({ ...range, limit: 10 })
  const { data: teams     = [], isLoading: teamsLoading }   = useTeamPerformance(range)

  // ── Derived KPIs ──────────────────────────────────────────────────────────
  const o          = summary?.orders  ?? {}
  const rev        = summary?.revenue ?? {}
  const prevRev    = prevSum?.revenue ?? {}
  const clientPaid = Number(o.total_sales || 0) + Number(o.delivery_fees || 0)
  const company    = Number(rev.company_revenue_earned || 0)
  const courier    = Number(rev.courier_payouts || 0)
  const netProfit  = company - courier
  const cashOnHand = logi?.cash_in_circulation ?? 0
  const kpiLoading = sumLoading || statsLoading

  const prevNetProfit = prevRange
    ? Number(prevRev.company_revenue_earned || 0) - Number(prevRev.courier_payouts || 0)
    : null

  const kpis = [
    { label: 'Выручка клиентов', value: `${fmtMoney(clientPaid)} с`, icon: <TrendingUp size={22}/>,   color: 'indigo'  },
    { label: 'Продажи товаров',  value: `${fmtMoney(o.total_sales)} с`, icon: <ShoppingCart size={22}/>, color: 'sky'  },
    { label: 'Доход компании',   value: `${fmtMoney(company)} с`,     icon: <BarChart2 size={22}/>,    color: 'emerald' },
    { label: 'Касса у курьеров', value: `${fmtMoney(cashOnHand)} с`,  icon: <Wallet size={22}/>,       color: cashOnHand > 0 ? 'amber' : 'sky' },
  ]

  // ── Alerts ────────────────────────────────────────────────────────────────
  const lowStockCount = inventory.filter(i => getStockStatus(i) === 'low_stock' || getStockStatus(i) === 'out_of_stock').length
  const alerts = []
  if ((stats?.unassigned ?? 0) > 0)
    alerts.push({ key: 'unassigned', dot: 'bg-orange-400', text: `${stats.unassigned} заказов без курьера`, to: '/owner/orders' })
  if ((prepayMeta?.total ?? 0) > 0)
    alerts.push({ key: 'prepay', dot: 'bg-amber-400', text: `${prepayMeta.total} заказов ждут проверки предоплаты`, to: '/owner/orders?status=prepayment_pending' })
  if ((issueMeta?.total ?? 0) > 0)
    alerts.push({ key: 'issue', dot: 'bg-rose-500', text: `${issueMeta.total} проблемных заказов`, to: '/owner/orders?status=issue' })
  if ((summary?.cash?.handovers_pending ?? 0) > 0)
    alerts.push({ key: 'handovers', dot: 'bg-amber-400', text: `${summary.cash.handovers_pending} передач кассы на проверке`, to: '/owner/finance' })
  if (logi?.biggest_debt_courier?.cash_debt > 1000)
    alerts.push({ key: 'debt', dot: 'bg-orange-400', text: `Долг по кассе: ${logi.biggest_debt_courier.full_name} (${fmtMoney(logi.biggest_debt_courier.cash_debt)} с)`, to: '/owner/logistics' })
  if (lowStockCount > 0)
    alerts.push({ key: 'stock', dot: 'bg-amber-400', text: `${lowStockCount} позиций с низким/нулевым остатком`, to: '/owner/warehouse' })
  const alertsLoading = statsLoading || prepayLoading || issueLoading || logiLoading

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['finance'] })
    qc.invalidateQueries({ queryKey: ['orders'] })
    qc.invalidateQueries({ queryKey: ['logistics'] })
    qc.invalidateQueries({ queryKey: ['warehouse'] })
  }, [qc])

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-6 pb-12">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Панель владельца</h1>
          <p className="text-xs text-slate-400 mt-0.5">Командный центр компании</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-0.5">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  period === p.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors flex-shrink-0"
            title="Обновить"
          >
            <RefreshCw size={14} className={sumFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* BLOCK 1 — Hero profit + secondary KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr_1fr] gap-3">
        {/* Hero — spans full width on mobile, 2 cols on lg */}
        <div className="lg:col-span-2">
          <HeroKpi
            label="Чистая прибыль компании"
            value={netProfit}
            prevValue={prevNetProfit}
            loading={sumLoading || (prevRange != null && prevLoading)}
          />
        </div>
        {/* Secondary KPIs */}
        {kpis.slice(0, 2).map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} color={k.color} loading={kpiLoading} />
        ))}
      </div>
      {/* Second row of KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Доставка с клиентов',  value: `${fmtMoney(o.delivery_fees)} с`, icon: <Truck size={22}/>,       color: 'violet'  },
          { label: 'Выплаты курьерам',     value: `${fmtMoney(courier)} с`,          icon: <Banknote size={22}/>,     color: 'amber'   },
          { label: 'Доход компании',       value: `${fmtMoney(company)} с`,           icon: <BarChart2 size={22}/>,    color: 'emerald' },
          { label: 'Заказов',             value: fmtNum(stats?.total),               icon: <Package size={22}/>,     color: 'indigo'  },
        ].map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} color={k.color} loading={kpiLoading} />
        ))}
      </div>

      {/* BLOCK 4 — Attention center (always above fold) */}
      <AttentionCenter items={alerts} loading={alertsLoading} onNav={onNav} />

      {/* BLOCK 2 + BLOCK 3 — Chart + Business health */}
      <div className="space-y-3">
        <SectionLabel icon={Activity}>Операции и динамика</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TrendChart data={dailyData} loading={dailyLoading} />
          <BusinessHealth stats={stats} logi={logi} loading={statsLoading || logiLoading} onNav={onNav} />
        </div>
      </div>

      {/* BLOCK 5 + BLOCK 6 — Team + Seller */}
      <div className="space-y-3">
        <SectionLabel icon={Trophy}>Результаты команд</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TeamPerformanceBlock teams={teams} loading={teamsLoading} onNav={onNav} />
          <SellerLeaderboard sellers={sellers} loading={sellersLoading} onNav={onNav} />
        </div>
      </div>

      {/* BLOCK 7 + BLOCK 8 — Logistics + Waterfall */}
      <div className="space-y-3">
        <SectionLabel icon={Wallet}>Логистика и прибыль</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LogisticsOverview data={logi} loading={logiLoading} onNav={onNav} />
          <FinancialWaterfall summary={summary} loading={sumLoading} />
        </div>
      </div>

      {/* BLOCK 9 + BLOCK 10 — Warehouse + Quick actions */}
      <div className="space-y-3">
        <SectionLabel icon={Package}>Склад и действия</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WarehouseRisks inventory={inventory} loading={invLoading} onNav={onNav} />
          <QuickActions onNav={onNav} />
        </div>
      </div>

    </div>
  )
}
