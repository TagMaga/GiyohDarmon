import { Link } from 'react-router-dom'
import Badge      from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { ClipboardList, Phone } from 'lucide-react'

/**
 * SellerOrderMobileCard — mobile card list (< lg).
 *
 * Props:
 *   orders     {Array}
 *   loading    {bool}
 *   showCreate {bool}
 */
export default function SellerOrderMobileCard({ orders = [], loading = false, showCreate = false }) {
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
            ? <Link to="/seller/orders/create" className="btn-md btn-primary btn">Создать заказ</Link>
            : null}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => (
        <div key={order.id} className="card p-4 space-y-2.5">
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-xs font-bold text-slate-800">
              {order.order_number ?? order.id?.slice(0, 8)}
            </span>
            <Badge variant={STATUS_BADGE[order.status] ?? 'slate'} dot size="md">
              {STATUS_LABELS[order.status] ?? order.status}
            </Badge>
          </div>

          {order.customer?.full_name && (
            <p className="text-sm font-semibold text-slate-800 leading-tight">
              {order.customer.full_name}
            </p>
          )}

          {order.customer?.phone && (
            <div className="flex items-center gap-1">
              <Phone size={11} className="text-slate-400" />
              <span className="text-xs text-slate-500">{order.customer.phone}</span>
            </div>
          )}

          <div className="flex items-center gap-4 text-xs pt-0.5">
            <div>
              <span className="text-slate-400">Сумма </span>
              <span className="font-semibold text-slate-800">{fmtAmount(order.total_amount)}</span>
            </div>
            {order.net_revenue != null && (
              <div>
                <span className="text-slate-400">Чистая </span>
                <span className="font-medium text-emerald-700">{fmtAmount(order.net_revenue)}</span>
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-400">{fmtDate(order.created_at)}</p>
        </div>
      ))}
    </div>
  )
}
