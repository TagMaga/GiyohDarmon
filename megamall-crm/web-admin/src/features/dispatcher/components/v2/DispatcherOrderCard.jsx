import { Check, Truck, AlertTriangle } from 'lucide-react'
import Badge from '../../../../shared/components/Badge'
import { STATUS_BADGE, STATUS_LABELS } from '../../../../shared/orderStatusConfig'
import { resolveCustomer, resolveAddress, resolveCity } from '../../utils/resolveCustomer'
import { resolveCourierDisplay, formatOrderLabel } from '../../utils/orderHelpers'
import { orderAge, orderAgeMinutes, isOverdue } from '../../statusConfig'

const fmt = (v) => v == null ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

export default function DispatcherOrderCard({ order, courierMap = {}, selected, onSelect, onAction }) {
  const customer    = resolveCustomer(order, {})
  const courierDisp = resolveCourierDisplay(order, courierMap)
  const address     = resolveAddress(order) || resolveCity(order) || '—'
  const ageMin      = orderAgeMinutes(order)
  const ageLabel    = orderAge(order)
  const urgent      = ageMin >= 60 || order.status === 'issue' || isOverdue(order)
  const isCash      = order.payment_method === 'cash' || order.payment_method === 'наличные'
  const statusVariant = STATUS_BADGE[order.status] ?? 'slate'

  return (
    <button
      onClick={() => onSelect(order)}
      className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-indigo-50/40 ${
        selected
          ? 'bg-indigo-50/60 border-l-2 border-l-indigo-500'
          : 'border-l-2 border-l-transparent'
      }`}
    >
      {/* Row 1: number · status · cash badge · age */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-mono font-bold text-slate-700 flex-shrink-0">#{formatOrderLabel(order)}</span>
          <Badge variant={statusVariant} size="sm">{STATUS_LABELS[order.status] ?? order.status}</Badge>
          {isCash && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">cash</span>
          )}
        </div>
        {ageLabel && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ml-1 ${
            urgent ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'
          }`}>
            {ageLabel}
          </span>
        )}
      </div>

      {/* Row 2: customer */}
      <div className="text-sm font-semibold text-slate-800 truncate mb-0.5">
        {customer.full_name || customer.phone || 'Клиент —'}
      </div>

      {/* Row 3: address */}
      <div className="text-xs text-slate-400 truncate mb-1.5">{address}</div>

      {/* Row 4: amount · courier · quick actions */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold text-slate-700 flex-shrink-0">
            {fmt(order.total_amount ?? order.total_order_amount)} сом
          </span>
          <span className="text-[10px] text-slate-400 truncate">
            {courierDisp.name || 'Без курьера'}
          </span>
        </div>
        {/* Quick action buttons — stop propagation so card click doesn't also fire */}
        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {order.status === 'new' && (
            <button
              className="p-1 rounded-lg bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
              title="Подтвердить"
              onClick={() => onAction('confirm', order)}
            >
              <Check size={12} />
            </button>
          )}
          {order.status === 'confirmed' && (
            <button
              className="p-1 rounded-lg bg-sky-100 text-sky-700 hover:bg-sky-200 transition-colors"
              title="Назначить курьера"
              onClick={() => onAction('assign', order)}
            >
              <Truck size={12} />
            </button>
          )}
          {order.status === 'issue' && (
            <button
              className="p-1 rounded-lg bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors"
              title="Решить проблему"
              onClick={() => onAction('resolve', order)}
            >
              <AlertTriangle size={12} />
            </button>
          )}
        </div>
      </div>
    </button>
  )
}
