import { Link } from 'react-router-dom'
import Badge from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { ClipboardList, Phone, ChevronRight } from 'lucide-react'

/**
 * Props:
 *   orders     {Array}
 *   loading    {bool}
 *   showCreate {bool}
 *   citiesById {Object} id→name map
 *   onDetail   {(order)=>void}
 */
export default function SellerOrderMobileCard({
  orders = [],
  loading = false,
  showCreate = false,
  citiesById = {},
  onDetail,
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<ClipboardList size={24} />}
          title="Нет заказов"
          description="Ваши заказы появятся здесь после создания."
          action={showCreate
            ? <Link to="/seller/orders/create" className="btn btn-primary btn-md">Создать заказ</Link>
            : null}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {orders.map(order => (
        <div
          key={order.id}
          className="card p-4 active:scale-[0.99] transition-transform"
          style={{ boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 8px 24px rgba(16,24,40,0.06)' }}
        >
          {/* Top row: order number + status */}
          <div className="flex items-start justify-between gap-2 mb-2.5">
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                {order.order_number ?? order.id?.slice(0, 8)}
              </p>
              <p className="text-[15px] font-bold text-slate-900 mt-0.5 leading-tight truncate">
                {order.customer?.full_name ?? '—'}
              </p>
              {order.customer?.phone && (
                <p className="text-xs text-slate-400 mt-0.5">{order.customer.phone}</p>
              )}
            </div>
            <Badge variant={STATUS_BADGE[order.status] ?? 'slate'} dot size="md">
              {STATUS_LABELS[order.status] ?? order.status}
            </Badge>
          </div>

          {/* City + date + address + amount */}
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-slate-400">
                {order.city_id && citiesById[order.city_id] && (
                  <span className="bg-slate-100 px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                    {citiesById[order.city_id]}
                  </span>
                )}
                <span className="flex-shrink-0">{fmtDate(order.created_at)}</span>
              </div>
              {order.delivery_address && (
                <p className="text-xs text-slate-500 truncate">{order.delivery_address}</p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-black text-slate-900">
                {fmtAmount(order.total_order_amount ?? order.total_amount)}
              </p>
              {order.net_revenue != null && (
                <p className="text-[11px] font-semibold text-emerald-600 mt-0.5">
                  +{fmtAmount(order.net_revenue)} чистая
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {order.customer?.phone && (
              <a
                href={`tel:${order.customer.phone}`}
                onClick={e => e.stopPropagation()}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-semibold min-h-[40px] active:scale-95 transition-transform"
              >
                <Phone size={13} />
                Позвонить
              </a>
            )}
            {onDetail && (
              <button
                onClick={() => onDetail(order)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-semibold min-h-[40px] active:scale-95 transition-transform"
              >
                <ChevronRight size={13} />
                Детали
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
