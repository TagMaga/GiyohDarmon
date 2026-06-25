import { Package, Truck, AlertTriangle, CheckCircle, UserX, Banknote } from 'lucide-react'
import { fmt } from '../../statusConfig'

const KPIS = [
  { filter: 'new',         icon: Package,       countKey: 'new',         label: 'Новые',       cls: 'text-indigo-600 bg-indigo-50 border-indigo-200', activeCls: 'bg-indigo-600 text-white border-indigo-600' },
  { filter: 'in_delivery', icon: Truck,         countKey: 'in_delivery', label: 'В доставке',  cls: 'text-amber-600 bg-amber-50 border-amber-200',   activeCls: 'bg-amber-500 text-white border-amber-500' },
  { filter: 'issue',       icon: AlertTriangle, countKey: 'issue',       label: 'Проблемы',    cls: 'text-rose-600 bg-rose-50 border-rose-200',       activeCls: 'bg-rose-600 text-white border-rose-600' },
  { filter: 'delivered',   icon: CheckCircle,   countKey: 'delivered',   label: 'Доставлено',  cls: 'text-emerald-600 bg-emerald-50 border-emerald-200', activeCls: 'bg-emerald-600 text-white border-emerald-600' },
  { filter: 'confirmed',   icon: UserX,         countKey: 'unassigned',  label: 'Без курьера', cls: 'text-orange-600 bg-orange-50 border-orange-200', activeCls: 'bg-orange-500 text-white border-orange-500' },
  { filter: null,          icon: Banknote,      countKey: null,          label: 'Долг',        cls: 'text-slate-600 bg-slate-50 border-slate-200',    activeCls: '' },
]

export default function DispatcherKPIs({ counts, cashOwed, activeFilter, onFilterClick }) {
  return (
    <div className="flex gap-2 px-4 py-2.5 border-b border-slate-100 overflow-x-auto flex-shrink-0 bg-white">
      {KPIS.map(kpi => {
        const Icon   = kpi.icon
        const value  = kpi.countKey ? (counts[kpi.countKey] ?? 0) : fmt(cashOwed)
        const isActive = kpi.filter && activeFilter === kpi.filter

        return (
          <button
            key={kpi.label}
            disabled={!kpi.filter}
            onClick={() => kpi.filter && onFilterClick?.(isActive ? 'all' : kpi.filter)}
            title={kpi.filter ? (isActive ? 'Сбросить фильтр' : `Показать: ${kpi.label}`) : undefined}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border flex-shrink-0 transition-all ${
              kpi.filter ? 'cursor-pointer' : 'cursor-default'
            } ${isActive ? kpi.activeCls : kpi.cls} ${
              kpi.filter && !isActive ? 'hover:opacity-80' : ''
            }`}
          >
            <Icon size={13} className="flex-shrink-0" />
            <div className="text-left leading-none">
              <div className="text-sm font-black">{value}</div>
              <div className={`text-[10px] font-semibold mt-0.5 ${isActive ? 'text-white/70' : 'text-slate-400'}`}>
                {kpi.label}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
