/**
 * OrdersKpiBar — top KPI strip for Owner Orders Center.
 *
 * Derives counts from the full (non-paginated) orders array passed from the page.
 * 5 tiles: Всего / Новые / В обработке / Доставлено / Отменено
 */
import { CardSkeleton } from '../../../shared/components/Skeleton'

const IN_PROGRESS_STATUSES = new Set([
  'confirmed', 'prepayment_pending', 'prepayment_received',
  'assigned', 'in_delivery',
])

function KpiTile({ label, value, accent = 'default', loading }) {
  const accentMap = {
    default: 'bg-white border-slate-100',
    rose:    'bg-rose-50 border-rose-100',
  }
  const valueColorMap = {
    default: 'text-slate-900',
    rose:    'text-rose-600',
  }
  const labelColorMap = {
    default: 'text-slate-400',
    rose:    'text-rose-500',
  }
  const cls = accentMap[accent] ?? accentMap.default

  return (
    <div className={`rounded-2xl border px-4 py-4 flex flex-col gap-2 ${cls}`}>
      <p className={`text-[10.5px] font-bold uppercase tracking-wide leading-tight ${labelColorMap[accent] ?? labelColorMap.default}`}>
        {label}
      </p>
      {loading ? (
        <div className="h-6 w-16 bg-slate-100 rounded-lg animate-pulse" />
      ) : (
        <p className={`text-[22px] font-bold leading-none tabular-nums ${valueColorMap[accent] ?? valueColorMap.default}`}>{value}</p>
      )}
    </div>
  )
}

export default function OrdersKpiBar({ orders = [], loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[1,2,3,4,5].map(i => <CardSkeleton key={i} />)}
      </div>
    )
  }

  const total      = orders.length
  const newCount   = orders.filter(o => (o.status ?? o.Status) === 'new').length
  const inProgress = orders.filter(o => IN_PROGRESS_STATUSES.has(o.status ?? o.Status ?? '')).length
  const delivered  = orders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const cancelled  = orders.filter(o => (o.status ?? o.Status) === 'cancelled').length

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <KpiTile label="Всего заказов"  value={total}       />
      <KpiTile label="Новые"          value={newCount}     />
      <KpiTile label="В обработке"    value={inProgress}   />
      <KpiTile label="Доставлено"     value={delivered}    />
      <KpiTile label="Отменено"       value={cancelled}    accent="rose" />
    </div>
  )
}
