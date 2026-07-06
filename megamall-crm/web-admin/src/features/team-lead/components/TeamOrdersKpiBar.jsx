/**
 * TeamOrdersKpiBar — 6 KPI tiles for Team Lead Orders page.
 * Same visual style as OrdersKpiBar but adds Выручка (net revenue total).
 */
import { Package, PackageCheck, PackageX, Loader2, Inbox, TrendingUp } from 'lucide-react'
import { fmtAmount } from '../../../shared/orderStatusConfig'

const IN_PROGRESS = new Set([
  'confirmed', 'prepayment_pending', 'prepayment_received', 'assigned', 'in_delivery',
])

function KpiTile({ icon, label, value, accent = 'indigo', loading }) {
  const cls = {
    indigo:  'bg-indigo-50  text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber:   'bg-amber-50   text-amber-600',
    rose:    'bg-rose-50    text-rose-600',
    sky:     'bg-sky-50     text-sky-600',
    violet:  'bg-violet-50  text-violet-600',
  }[accent] ?? 'bg-indigo-50 text-indigo-600'

  return (
    <div className="card p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${cls}`}>
          {icon}
        </span>
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide leading-tight">
          {label}
        </p>
      </div>
      {loading
        ? <div className="h-7 w-16 bg-slate-200 rounded-lg animate-pulse" />
        : <p className="text-2xl font-bold text-slate-900 leading-none">{value}</p>
      }
    </div>
  )
}

export default function TeamOrdersKpiBar({ orders = [], loading }) {
  const total      = orders.length
  const newOrders  = orders.filter(o => (o.status ?? o.Status) === 'new').length
  const inDelivery = orders.filter(o => (o.status ?? o.Status) === 'in_delivery').length
  const delivered  = orders.filter(o => (o.status ?? o.Status) === 'delivered').length
  const cancelled  = orders.filter(o => (o.status ?? o.Status) === 'cancelled').length
  const revenue    = orders.reduce((s, o) => {
    return s + Number(o.net_revenue ?? o.total_amount ?? o.amount ?? 0)
  }, 0)

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      <KpiTile icon={<Package      size={16} />} label="Всего"      value={total}                   accent="indigo"  loading={loading} />
      <KpiTile icon={<Inbox        size={16} />} label="Новые"      value={newOrders}               accent="sky"     loading={loading} />
      <KpiTile icon={<Loader2      size={16} />} label="В доставке" value={inDelivery}              accent="amber"   loading={loading} />
      <KpiTile icon={<PackageCheck size={16} />} label="Доставлено" value={delivered}               accent="emerald" loading={loading} />
      <KpiTile icon={<PackageX     size={16} />} label="Отменено"   value={cancelled}               accent="rose"    loading={loading} />
      <KpiTile icon={<TrendingUp   size={16} />} label="Выручка"    value={`${fmtAmount(revenue)} смн`} accent="violet" loading={loading} />
    </div>
  )
}
