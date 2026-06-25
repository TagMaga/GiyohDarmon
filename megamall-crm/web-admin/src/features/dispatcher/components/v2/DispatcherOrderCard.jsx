import Badge from '../../../../shared/components/Badge'
import { STATUS_BADGE, STATUS_LABELS } from '../../../../shared/orderStatusConfig'
import { resolveCustomer, resolveCity } from '../../utils/resolveCustomer'
import { resolveCourierDisplay, formatOrderLabel } from '../../utils/orderHelpers'
import { orderAge, orderAgeMinutes, isOverdue } from '../../statusConfig'
import DispatcherActionMenu from './DispatcherActionMenu'

const fmt = (v) => v == null ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

export default function DispatcherOrderCard({ order, courierMap = {}, selected, onSelect, onAction }) {
  const customer    = resolveCustomer(order, {})
  const courierDisp = resolveCourierDisplay(order, courierMap)
  const city        = resolveCity(order)
  const ageMin      = orderAgeMinutes(order)
  const ageLabel    = orderAge(order)
  const urgent      = ageMin >= 60 || order.status === 'issue' || isOverdue(order)
  const isCash      = order.payment_method === 'cash' || order.payment_method === 'наличные'
  const hasPrepay   = Number(order.prepayment_amount ?? 0) > 0
  const statusVar   = STATUS_BADGE[order.status] ?? 'slate'
  const sellerName  = order.seller?.full_name ?? order.seller_name ?? null
  const amount      = order.total_order_amount ?? order.total_amount

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(order)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(order) } }}
      className={`w-full text-left px-4 py-3 border-b border-slate-50 transition-colors cursor-pointer hover:bg-slate-50 focus:outline-none focus-visible:bg-indigo-50/40 ${
        selected
          ? 'bg-indigo-50/60 border-l-2 border-l-indigo-500'
          : 'border-l-2 border-l-transparent'
      }`}
    >
      {/* ── Top row: order number + status + menu ── */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-mono font-bold text-slate-700 flex-shrink-0">
            #{formatOrderLabel(order)}
          </span>
          <Badge variant={statusVar} size="sm">{STATUS_LABELS[order.status] ?? order.status}</Badge>
          {isCash && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0">
              cash
            </span>
          )}
          {hasPrepay && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 flex-shrink-0">
              prepay
            </span>
          )}
        </div>
        <DispatcherActionMenu order={order} onAction={onAction} className="ml-1" />
      </div>

      {/* ── Middle: customer name + amount ── */}
      <div className="flex items-baseline justify-between gap-2 mb-0.5">
        <span className="text-sm font-semibold text-slate-800 truncate">
          {customer.full_name || customer.phone || 'Клиент —'}
        </span>
        <span className="text-xs font-bold text-slate-700 flex-shrink-0">
          {fmt(amount)} сом
        </span>
      </div>

      {/* ── Bottom: seller · courier · city · age ── */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 text-[10px] text-slate-400">
          {sellerName && (
            <>
              <span className="truncate max-w-[80px]">{sellerName}</span>
              <span>·</span>
            </>
          )}
          <span className="truncate max-w-[90px]">
            {courierDisp.name || 'Без курьера'}
          </span>
          {city && (
            <>
              <span>·</span>
              <span className="truncate max-w-[60px]">{city}</span>
            </>
          )}
        </div>
        {ageLabel && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 ${
            urgent ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-400'
          }`}>
            {ageLabel}
          </span>
        )}
      </div>
    </div>
  )
}
