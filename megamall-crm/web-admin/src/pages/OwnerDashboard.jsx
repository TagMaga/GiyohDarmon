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
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import {
  ArrowRight,
} from 'lucide-react'

import useFinanceSummary    from '../features/finance/hooks/useFinanceSummary'
import useLogisticsDashboard from '../features/logistics/hooks/useLogisticsDashboard'
import useOrderStats        from '../features/owner/hooks/useOrderStats'
import useOwnerOrders       from '../features/orders/hooks/useOwnerOrders'
import useInventory         from '../features/warehouse/hooks/useInventory'
import useFinanceDaily      from '../features/owner/hooks/useFinanceDaily'
import useSellerLeaderboard from '../features/owner/hooks/useSellerLeaderboard'
import useTeamPerformance   from '../features/owner/hooks/useTeamPerformance'
import { getStockStatus }   from '../features/warehouse/utils/warehouseHelpers'
import DesktopDateRangePicker from '../shared/components/DesktopDateRangePicker'

// ── Date helpers ──────────────────────────────────────────────────────────────
function toYMD(d) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}

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

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtMoney = (v) => Number(v || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })
const fmtNum   = (v) => Number(v || 0).toLocaleString('ru-RU')
const fmtPct   = (v) => v != null ? `${v.toFixed(1)}%` : '—'

// team_payouts/company_gross/net_profit all come straight from the backend —
// summed from the real financial_events ledger and the business-expense
// categories, never re-derived as a hardcoded percentage here.
function ownerFinanceKpis(orders = {}, expenses = {}) {
  return {
    commissionBase: Number(orders.commission_base || 0),
    teamPayouts:    Number(orders.team_payouts || 0),
    companyIncome:  Number(expenses.net_profit || 0),
  }
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Card({ title, titleIcon: TitleIcon, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-2">
            {TitleIcon && (
              <span className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                <TitleIcon size={13} className="text-slate-500" />
              </span>
            )}
            <h2 className="text-[15px] font-bold text-slate-950">{title}</h2>
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
    <button onClick={onClick} className="flex items-center gap-1 text-[13px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors">
      {children} <ArrowRight size={13} />
    </button>
  )
}

// ── BLOCK 1 — Finance KPI tiles ───────────────────────────────────────────────

function FinanceSummaryStrip({ orders, revenue, expenses, loading }) {
  const { teamPayouts, companyIncome } = ownerFinanceKpis(orders, expenses)
  const metrics = [
    { label: 'Продажи товаров', value: `${fmtMoney(orders?.total_sales)} с`, dot: 'bg-sky-500', tone: 'text-sky-950', panel: 'from-sky-50 to-cyan-100' },
    { label: 'Доставлено заказов', value: fmtNum(orders?.delivered_count), dot: 'bg-indigo-500', tone: 'text-indigo-950', panel: 'from-indigo-50 to-violet-100' },
    { label: 'Доставка курьерам', value: `${fmtMoney(orders?.courier_payout)} с`, dot: 'bg-violet-500', tone: 'text-violet-950', panel: 'from-violet-50 to-fuchsia-100' },
    { label: 'Выплаты команде', value: `${fmtMoney(teamPayouts)} с`, dot: 'bg-amber-500', tone: 'text-amber-950', panel: 'from-amber-50 to-yellow-100' },
    { label: 'Себестоимость товара', value: `${fmtMoney(orders?.product_cost)} с`, dot: 'bg-emerald-500', tone: 'text-emerald-950', panel: 'from-emerald-50 to-teal-100' },
    { label: 'Доход компании', value: `${fmtMoney(companyIncome)} с`, dot: 'bg-rose-500', tone: 'text-rose-950', panel: 'from-rose-50 to-orange-100', result: true },
  ]

  if (loading) {
    return (
      <section className="rounded-2xl md:rounded-3xl border border-slate-100 bg-white shadow-sm p-3 md:p-5">
        <div className="h-5 w-40 bg-slate-100 rounded-lg animate-pulse mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-28 md:h-36 bg-slate-50 rounded-2xl animate-pulse" />)}
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-2xl md:rounded-3xl border border-slate-100 bg-white shadow-sm overflow-hidden">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 md:gap-4 p-3 md:p-4">
        {metrics.map((item) => (
          <div
            key={item.label}
            className={`rounded-2xl border bg-gradient-to-br ${item.panel} px-3.5 py-4 md:px-7 md:py-7 min-h-[104px] md:min-h-[150px] shadow-sm ${
              item.result
                ? 'border-rose-300 ring-4 ring-rose-100 shadow-lg shadow-rose-100'
                : 'border-white/70'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${item.dot}`} />
              <p className="text-[10px] md:text-[12px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">
                {item.label}
              </p>
            </div>
            <p className={`mt-4 md:mt-5 font-bold leading-tight tabular-nums ${item.result ? 'text-[25px] md:text-[48px]' : 'text-[23px] md:text-[42px]'} ${item.tone}`}>
              {item.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── BLOCK 2 — Trend chart ─────────────────────────────────────────────────────

const CHART_TABS = [
  { key: 'revenue', label: 'Выручка',   color: '#6366f1', field: 'total_sales' },
  { key: 'profit',  label: 'Прибыль', color: '#10b981', field: 'company_revenue' },
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
      <Card title="Динамика выручки" className="min-h-[260px]">
        <div className="mx-5 mb-5 mt-3 h-44 bg-slate-50 rounded-xl animate-pulse" />
      </Card>
    )
  }

  if (data.length === 0) {
    return (
      <Card title="Динамика выручки" className="min-h-[260px]">
        <div className="px-5 pb-8 pt-5 text-center text-sm text-slate-400">
          Нет данных для выбранного периода
        </div>
      </Card>
    )
  }

  return (
    <Card
      title="Динамика выручки"
      className="min-h-[260px]"
      action={
        <div className="flex gap-1">
          {CHART_TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${
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
      <div className="px-5 pb-5 pt-3">
        <ResponsiveContainer width="100%" height={170}>
          <AreaChart data={formatted} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={cfg.color} stopOpacity={0.15} />
                <stop offset="95%" stopColor={cfg.color} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              hide
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

// ── BLOCK 3 — Attention center ────────────────────────────────────────────────

function AttentionCenter({ items, loading, onNav, successRate }) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm px-5 py-4 space-y-2 min-h-[260px]">
        {[...Array(3)].map((_, i) => <div key={i} className="h-9 bg-slate-50 rounded-xl animate-pulse" />)}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <Card title="Требует внимания" className="min-h-[260px]">
        <div className="px-5 pb-5 pt-3">
          <div className="rounded-xl bg-emerald-50 px-4 py-3 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            <p className="text-sm font-medium text-emerald-800">Всё в порядке</p>
          </div>
        </div>
      </Card>
    )
  }
  return (
    <Card
      title="Требует внимания"
      className="min-h-[260px]"
      action={<span className="rounded-full bg-rose-500 px-2.5 py-1 text-[12px] font-bold leading-none text-white">{items.length}</span>}
    >
      <div className="px-5 pb-5 pt-1">
        {items.map((it) => (
          <button
            key={it.key}
            onClick={() => onNav(it.to)}
            className="w-full py-3 flex items-center gap-3 border-b border-slate-50 hover:bg-slate-50/60 transition-colors text-left group"
          >
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${it.dot}`} />
            <p className="text-[15px] font-medium text-slate-700 flex-1 leading-snug">{it.text}</p>
            <span className="text-[13px] font-bold text-indigo-600 whitespace-nowrap">{it.action ?? 'Открыть'} →</span>
          </button>
        ))}
        <div className="mt-4 rounded-[10px] bg-slate-50 px-3.5 py-3 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-slate-500">Успешность доставки</span>
          <span className="text-[16px] font-extrabold text-slate-950 tabular-nums">{successRate ?? '—'}</span>
        </div>
      </div>
    </Card>
  )
}

// ── BLOCK 5 — Team performance ────────────────────────────────────────────────

function TeamPerformanceBlock({ teams = [], loading, onNav }) {
  return (
    <Card
      title="Команды"
      action={<LinkBtn onClick={() => onNav('/owner/teams')}>Все</LinkBtn>}
      className="min-h-[205px]"
    >
      <div className="px-5 pb-5 pt-3">
        {loading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-50 rounded-xl animate-pulse" />)}</div>
        ) : teams.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Нет данных за период</p>
        ) : (
          <div className="space-y-0 divide-y divide-slate-50">
            {teams.slice(0, 3).map((t, i) => (
              <div key={t.team_lead_id} className="flex items-center gap-3 py-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  i === 0 ? 'bg-amber-100 text-amber-700'
                  : i === 1 ? 'bg-slate-100 text-slate-600'
                  : 'bg-slate-50 text-slate-400'
                }`}>{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-bold text-slate-900 truncate">
                    {t.team_name || t.team_lead_name || 'Команда'}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[15px] font-extrabold text-slate-900 tabular-nums">{fmtMoney(t.total_revenue)} с</p>
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
      action={<LinkBtn onClick={() => onNav('/owner/team-directory')}>Все</LinkBtn>}
      className="min-h-[205px]"
    >
      <div className="px-5 pb-5 pt-3">
        {loading ? (
          <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-50 rounded-xl animate-pulse" />)}</div>
        ) : sellers.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">Нет данных за период</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {sellers.slice(0, 3).map((s) => (
              <div key={s.seller_id} className="flex items-center gap-3 py-3 hover:bg-slate-50/50 transition-colors">
                <p className="flex-1 min-w-0 text-[15px] font-bold text-slate-900 truncate">{s.full_name}</p>
                <p className="text-[15px] font-extrabold text-slate-900 tabular-nums text-right whitespace-nowrap">{fmtMoney(s.total_revenue)} с</p>
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
    { label: 'Занято',      value: fmtNum(d.busy_couriers), accent: 'text-slate-950', tone: 'bg-slate-50' },
    { label: 'Свободно',    value: fmtNum(d.free_couriers), accent: 'text-emerald-600', tone: 'bg-slate-50' },
    { label: 'Сред. время', value: d.avg_delivery_minutes > 0 ? `${Math.round(d.avg_delivery_minutes)} мин` : '—', accent: 'text-slate-950', tone: 'bg-slate-50' },
    { label: 'Без курьера', value: fmtNum(d.orders_without_courier), accent: 'text-rose-600', tone: 'bg-rose-50' },
  ]

  return (
    <Card
      title="Логистика сейчас"
      action={<LinkBtn onClick={() => onNav('/owner/logistics')}>Детали</LinkBtn>}
      className="min-h-[205px]"
    >
      <div className="px-5 pb-5 pt-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5">{[...Array(4)].map((_, i) => <div key={i} className="h-[62px] bg-slate-50 rounded-[10px] animate-pulse" />)}</div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {stats.map(({ label, value, accent, tone }) => (
              <div key={label} className={`rounded-[10px] px-3 py-3 ${tone}`}>
                <p className={`text-[11px] font-bold ${label === 'Без курьера' ? 'text-rose-600' : 'text-slate-400'}`}>{label}</p>
                <p className={`mt-1 text-[22px] font-extrabold leading-none tabular-nums ${accent}`}>{value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function OwnerDashboard() {
  const navigate = useNavigate()
  const [range, setRange] = useState(() => periodRange('month'))
  const onNav    = useCallback((to) => navigate(to), [navigate])

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: summary,  isLoading: sumLoading } = useFinanceSummary(range)
  const { data: stats,    isLoading: statsLoading } = useOrderStats(range)
  const { data: logi,     isLoading: logiLoading  } = useLogisticsDashboard()
  const { meta: prepayMeta, isLoading: prepayLoading } = useOwnerOrders({ status: 'prepayment_pending', limit: 1 })
  const { meta: issueMeta,  isLoading: issueLoading  } = useOwnerOrders({ status: 'issue', limit: 1 })
  const { data: inventory = [] } = useInventory()
  const { data: dailyData = [], isLoading: dailyLoading } = useFinanceDaily(range)
  const { data: sellers   = [], isLoading: sellersLoading } = useSellerLeaderboard({ ...range, limit: 10 })
  const { data: teams     = [], isLoading: teamsLoading }   = useTeamPerformance(range)

  // ── Derived KPIs ──────────────────────────────────────────────────────────
  // ── Alerts ────────────────────────────────────────────────────────────────
  const lowStockCount = inventory.filter(i => getStockStatus(i) === 'low_stock' || getStockStatus(i) === 'out_of_stock').length
  const alerts = []
  if ((stats?.unassigned ?? 0) > 0)
    alerts.push({ key: 'unassigned', dot: 'bg-rose-500', text: `${stats.unassigned} заказов без курьера`, action: 'Назначить', to: '/owner/orders' })
  if ((prepayMeta?.total ?? 0) > 0)
    alerts.push({ key: 'prepay', dot: 'bg-amber-500', text: `${prepayMeta.total} заказов ждут проверки предоплаты`, action: 'Проверить', to: '/owner/orders?status=prepayment_pending' })
  if ((issueMeta?.total ?? 0) > 0)
    alerts.push({ key: 'issue', dot: 'bg-rose-500', text: `${issueMeta.total} проблемных заказов`, action: 'Открыть', to: '/owner/orders?status=issue' })
  if ((summary?.cash?.handovers_pending ?? 0) > 0)
    alerts.push({ key: 'handovers', dot: 'bg-amber-500', text: `${summary.cash.handovers_pending} передачи кассы на проверке`, action: 'Проверить', to: '/owner/finance' })
  if (logi?.biggest_debt_courier?.cash_debt > 1000)
    alerts.push({ key: 'debt', dot: 'bg-orange-500', text: `Долг по кассе: ${logi.biggest_debt_courier.full_name} (${fmtMoney(logi.biggest_debt_courier.cash_debt)} с)`, action: 'Проверить', to: '/owner/logistics' })
  if (lowStockCount > 0)
    alerts.push({ key: 'stock', dot: 'bg-amber-500', text: `${lowStockCount} позиций заканчиваются на складе`, action: 'Склад', to: '/owner/warehouse' })
  const alertsLoading = statsLoading || prepayLoading || issueLoading || logiLoading
  const delivered = stats?.by_status?.delivered ?? 0
  const successRate = stats?.total > 0 ? `${((delivered / stats.total) * 100).toFixed(0)}%` : (logi?.success_rate > 0 ? `${logi.success_rate.toFixed(0)}%` : '—')

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="animate-fade-in space-y-4 md:space-y-6 px-3 pt-5 pb-28 md:p-6 md:pb-12">

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg md:text-[22px] font-bold text-slate-900 tracking-tight">Панель владельца</h1>
          <p className="text-xs md:text-[12.5px] text-slate-400 mt-0.5">Командный центр компании</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DesktopDateRangePicker
            from={range.from ?? ''}
            to={range.to ?? ''}
            onChange={(nextRange) => setRange({ from: nextRange.from, to: nextRange.to })}
            align="right"
          />
        </div>
      </div>

      <FinanceSummaryStrip
        orders={summary?.orders}
        revenue={summary?.revenue}
        expenses={summary?.expenses}
        loading={sumLoading}
      />

      {/* Image-2 layout: chart + attention first, then three operational cards */}
      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-4">
        <TrendChart data={dailyData} loading={dailyLoading} />
        <AttentionCenter items={alerts.slice(0, 3)} loading={alertsLoading} onNav={onNav} successRate={successRate} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TeamPerformanceBlock teams={teams} loading={teamsLoading} onNav={onNav} />
        <SellerLeaderboard sellers={sellers} loading={sellersLoading} onNav={onNav} />
        <LogisticsOverview data={logi} loading={logiLoading} onNav={onNav} />
      </div>

    </div>
  )
}
