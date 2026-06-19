/**
 * LogisticsKpiStrip — compact KPI cards for the logistics dashboard header.
 * 12 key metrics in a responsive 2/3/4-column grid.
 */
import {
  Truck, Package, Banknote, Clock, CheckCircle2, AlertTriangle,
  TrendingUp, Users, CircleDot, AlertCircle,
} from 'lucide-react'

const fmtNum = (n) =>
  n == null ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const fmtMoney = (n) =>
  n == null ? '—' : Number(n).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

const fmtPct = (n) =>
  n == null ? '—' : `${Number(n).toFixed(1)}%`

const fmtMin = (n) => {
  if (n == null || n === 0) return '—'
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return h > 0 ? `${h}ч ${m}м` : `${m}м`
}

const TILES = (d) => [
  {
    label: 'Активных курьеров',
    value: `${d.busy_couriers} / ${d.active_couriers}`,
    sub: `${d.free_couriers} свободны`,
    icon: <Truck size={18} />,
    color: 'indigo',
  },
  {
    label: 'Заказы назначены сегодня',
    value: fmtNum(d.orders_assigned_today),
    icon: <Package size={18} />,
    color: 'sky',
  },
  {
    label: 'Ожидаемый кэш',
    value: `${fmtMoney(d.cash_expected)} сом`,
    sub: 'по всем доставкам',
    icon: <Banknote size={18} />,
    color: 'emerald',
  },
  {
    label: 'Кэш в обороте',
    value: `${fmtMoney(d.cash_in_circulation)} сом`,
    sub: 'не в передаче',
    icon: <CircleDot size={18} />,
    color: 'amber',
  },
  {
    label: 'Передано сегодня',
    value: `${fmtMoney(d.cash_handed_over_today)} сом`,
    icon: <CheckCircle2 size={18} />,
    color: 'emerald',
  },
  {
    label: 'Передано за неделю',
    value: `${fmtMoney(d.cash_handed_over_week)} сом`,
    icon: <TrendingUp size={18} />,
    color: 'violet',
  },
  {
    label: 'Просроченные доставки',
    value: fmtNum(d.overdue_deliveries),
    icon: <AlertTriangle size={18} />,
    color: d.overdue_deliveries > 0 ? 'rose' : 'emerald',
  },
  {
    label: 'Неудачных сегодня',
    value: fmtNum(d.failed_today),
    icon: <AlertCircle size={18} />,
    color: d.failed_today > 0 ? 'amber' : 'slate',
  },
  {
    label: 'Успешность доставок',
    value: fmtPct(d.success_rate),
    icon: <CheckCircle2 size={18} />,
    color: d.success_rate >= 90 ? 'emerald' : d.success_rate >= 70 ? 'amber' : 'rose',
  },
  {
    label: 'Среднее время доставки',
    value: fmtMin(d.avg_delivery_minutes),
    icon: <Clock size={18} />,
    color: 'sky',
  },
  {
    label: 'Без курьера',
    value: fmtNum(d.orders_without_courier),
    sub: 'подтверждённых заказов',
    icon: <Users size={18} />,
    color: d.orders_without_courier > 0 ? 'amber' : 'slate',
  },
  {
    label: 'Рискуют опоздать',
    value: fmtNum(d.at_risk_deliveries),
    sub: '2–4 часа в пути',
    icon: <AlertTriangle size={18} />,
    color: d.at_risk_deliveries > 0 ? 'amber' : 'slate',
  },
]

const COLOR = {
  indigo:  { wrap: 'bg-indigo-50  border-indigo-100', icon: 'text-indigo-600 bg-indigo-100', val: 'text-indigo-900' },
  sky:     { wrap: 'bg-sky-50     border-sky-100',    icon: 'text-sky-600    bg-sky-100',    val: 'text-sky-900'    },
  emerald: { wrap: 'bg-emerald-50 border-emerald-100',icon: 'text-emerald-600 bg-emerald-100', val: 'text-emerald-900' },
  amber:   { wrap: 'bg-amber-50   border-amber-100',  icon: 'text-amber-600  bg-amber-100',  val: 'text-amber-900'  },
  violet:  { wrap: 'bg-violet-50  border-violet-100', icon: 'text-violet-600 bg-violet-100', val: 'text-violet-900' },
  rose:    { wrap: 'bg-rose-50    border-rose-100',   icon: 'text-rose-600   bg-rose-100',   val: 'text-rose-900'   },
  slate:   { wrap: 'bg-slate-50   border-slate-100',  icon: 'text-slate-500  bg-slate-100',  val: 'text-slate-700'  },
}

function KpiTile({ label, value, sub, icon, color = 'indigo', loading }) {
  const c = COLOR[color] ?? COLOR.indigo
  if (loading) {
    return (
      <div className={`rounded-2xl border p-4 ${c.wrap}`}>
        <div className="skeleton w-8 h-8 rounded-xl mb-3" />
        <div className="skeleton w-16 h-6 rounded-lg mb-1.5" />
        <div className="skeleton w-24 h-3.5 rounded-full" />
      </div>
    )
  }
  return (
    <div className={`rounded-2xl border p-4 transition-transform duration-200 hover:-translate-y-0.5 ${c.wrap}`}>
      <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-3 ${c.icon}`}>
        {icon}
      </div>
      <p className={`text-xl font-bold leading-tight mb-0.5 ${c.val}`}>{value}</p>
      <p className="text-[12px] font-medium text-slate-600 leading-tight">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function LogisticsKpiStrip({ data, loading }) {
  const tiles = data ? TILES(data) : Array(12).fill({})

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
      {tiles.map((t, i) => (
        <KpiTile key={i} {...t} loading={loading} />
      ))}
    </div>
  )
}
