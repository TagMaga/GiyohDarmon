import { Package, Truck, AlertTriangle, CheckCircle, UserX, Banknote } from 'lucide-react'
import { fmt } from '../../statusConfig'

export default function DispatcherKPIs({ counts, cashOwed, onFilterClick }) {
  const kpis = [
    { icon: Package,       value: counts.new,         label: 'Новые',       alert: counts.new > 0,        filter: 'new',         cls: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
    { icon: Truck,         value: counts.in_delivery, label: 'В доставке',  alert: false,                 filter: 'in_delivery', cls: 'text-amber-600 bg-amber-50 border-amber-200' },
    { icon: AlertTriangle, value: counts.issue,        label: 'Проблемы',    alert: counts.issue > 0,      filter: 'issue',       cls: 'text-rose-600 bg-rose-50 border-rose-200' },
    { icon: CheckCircle,   value: counts.delivered,   label: 'Доставлено',  alert: false,                 filter: 'delivered',   cls: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    { icon: UserX,         value: counts.unassigned,  label: 'Без курьера', alert: counts.unassigned > 0, filter: 'confirmed',   cls: 'text-orange-600 bg-orange-50 border-orange-200' },
    { icon: Banknote,      value: fmt(cashOwed),      label: 'Долг',        alert: cashOwed > 0,          filter: null,          cls: 'text-slate-600 bg-slate-50 border-slate-200' },
  ]

  return (
    <div className="flex gap-2 px-4 py-2.5 border-b border-slate-100 overflow-x-auto flex-shrink-0 bg-white">
      {kpis.map((kpi) => {
        const Icon = kpi.icon
        return (
          <button
            key={kpi.label}
            disabled={!kpi.filter}
            onClick={() => kpi.filter && onFilterClick?.(kpi.filter)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border flex-shrink-0 transition-opacity ${
              kpi.filter ? 'cursor-pointer hover:opacity-75' : 'cursor-default'
            } ${kpi.cls}`}
          >
            <Icon size={13} className="flex-shrink-0" />
            <div className="text-left leading-none">
              <div className="text-sm font-black">{kpi.value}</div>
              <div className="text-[10px] font-semibold text-slate-400 mt-0.5">{kpi.label}</div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
