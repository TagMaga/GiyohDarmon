/**
 * OrdersKpiBar — top KPI strip for Owner Orders Center.
 *
 * Derives counts from the full (non-paginated) orders array passed from the page.
 * 6 tiles: Всего / Новые / В обработке / Доставлено / Отменено / Конверсия
 */
import { Package, PackageCheck, PackageX, Loader2, Inbox, Percent } from 'lucide-react'
import { CardSkeleton } from '../../../shared/components/Skeleton'

const IN_PROGRESS_STATUSES = new Set([
  'confirmed', 'prepayment_pending', 'prepayment_received',
  'assigned', 'in_delivery',
])

function KpiTile({ icon, label, value, accent = 'indigo', loading }) {
  const accentMap = {
    indigo:  'bg-indigo-50  text-indigo-600  border-indigo-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    amber:   'bg-amber-50   text-amber-600   border-amber-100',
    rose:    'bg-rose-50    text-rose-600    border-rose-100',
    violet:  'bg-violet-50  text-violet-600  border-violet-100',
    sky:     'bg-sky-50     text-sky-600     border-sky-100',
  }
  const cls = accentMap[accent] ?? accentMap.indigo

  return (
    <div className={`card p-4 border ${cls} flex flex-col gap-1.5`}>
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${cls}`}>
          {icon}
        </span>
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide leading-tight">
          {label}
        </p>
      </div>
      {loading ? (
        <div className="h-7 w-16 bg-slate-200 rounded-lg animate-pulse" />
      ) : (
        <p className="text-2xl font-bold text-slate-900 leading-none">{value}</p>
      )}
    </div>
  )
}

export default function OrdersKpiBar({ orders = [], loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[1,2,3,4,5,6].map(i => <CardSkeleton key={i} />)}
      </div>
    )
  }

  const total      = orders.length
  const newCount   = orders.filter(o => (o.status ?? o.Status) === 'new').length
  const inProgress = orders.filter(o => IN_PROGRESS_STATUSES.has(o.status ?? o.Status ?? '')).length
  const delivered  = orders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const cancelled  = orders.filter(o => (o.status ?? o.Status) === 'cancelled').length
  const conversion = total > 0 ? ((delivered / total) * 100).toFixed(1) : '0.0'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <KpiTile icon={<Package  size={16} />} label="Всего заказов"  value={total}       accent="indigo"  />
      <KpiTile icon={<Inbox    size={16} />} label="Новые"          value={newCount}     accent="sky"     />
      <KpiTile icon={<Loader2  size={16} />} label="В обработке"    value={inProgress}   accent="amber"   />
      <KpiTile icon={<PackageCheck size={16} />} label="Доставлено" value={delivered}    accent="emerald" />
      <KpiTile icon={<PackageX size={16} />} label="Отменено"       value={cancelled}    accent="rose"    />
      <KpiTile icon={<Percent  size={16} />} label="Конверсия"      value={`${conversion}%`} accent="violet" />
    </div>
  )
}
