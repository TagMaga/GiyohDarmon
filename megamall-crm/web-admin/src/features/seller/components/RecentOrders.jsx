import { Link } from 'react-router-dom'
import Badge from '../../../shared/components/Badge'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import EmptyState from '../../../shared/components/EmptyState'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { ClipboardList, ArrowRight } from 'lucide-react'

/**
 * RecentOrders — last 5 orders shown on the seller home dashboard.
 *
 * Props:
 *   orders  {Array}
 *   loading {bool}
 */
export default function RecentOrders({ orders = [], loading = false }) {
  const recent = orders.slice(0, 5)

  return (
    <div className="card">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">Последние заказы</span>
        <Link
          to="/seller/orders"
          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
        >
          Все заказы <ArrowRight size={12} />
        </Link>
      </div>

      {loading && (
        <div className="p-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      )}

      {!loading && recent.length === 0 && (
        <EmptyState
          icon={<ClipboardList size={22} />}
          title="Нет заказов"
          description="Создайте первый заказ прямо сейчас."
        />
      )}

      {!loading && recent.map((order) => (
        <div key={order.id} className="px-5 py-3.5 border-b border-slate-50 last:border-0 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-slate-800">
                {order.order_number ?? order.id?.slice(0, 8)}
              </span>
              <Badge variant={STATUS_BADGE[order.status] ?? 'slate'} dot>
                {STATUS_LABELS[order.status] ?? order.status}
              </Badge>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {order.customer?.full_name ?? '—'} · {fmtDate(order.created_at)}
            </p>
          </div>
          <span className="text-sm font-semibold text-slate-800 flex-shrink-0">
            {fmtAmount(order.total_amount)}
          </span>
        </div>
      ))}
    </div>
  )
}
