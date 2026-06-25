import { Link } from 'react-router-dom'
import Badge      from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import { TableRowSkeleton } from '../../../shared/components/Skeleton'
import { STATUS_LABELS, STATUS_BADGE, fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { ClipboardList, ExternalLink } from 'lucide-react'

/**
 * Props:
 *   orders       {Array}
 *   loading      {bool}
 *   showCreate   {bool}
 *   citiesById   {Object} id→name map for city lookup
 *   onDetail     {(order)=>void}
 */
export default function SellerOrdersTable({ orders = [], loading = false, showCreate = false, citiesById = {}, onDetail }) {
  const HEADERS = ['Заказ', 'Клиент', 'Телефон', 'Город', 'Сумма', 'Доставка', 'Чистая', 'Статус', 'Дата', '']
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              {HEADERS.map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 5 }).map((_, i) => <TableRowSkeleton key={i} cols={HEADERS.length} />)}

            {!loading && orders.length === 0 && (
              <tr>
                <td colSpan={HEADERS.length}>
                  <EmptyState
                    icon={<ClipboardList size={24} />}
                    title="Нет заказов"
                    description="Ваши заказы появятся здесь после создания."
                    action={showCreate
                      ? <Link to="/seller/orders/create" className="btn-md btn-primary btn">Создать заказ</Link>
                      : null}
                  />
                </td>
              </tr>
            )}

            {!loading && orders.map((order) => (
              <tr key={order.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs font-bold text-slate-800">
                    {order.order_number ?? order.id?.slice(0, 8)}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-700 max-w-[140px] truncate">
                  {order.customer?.full_name ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {order.customer?.phone
                    ? <a href={`tel:${order.customer.phone}`} className="hover:text-indigo-600">{order.customer.phone}</a>
                    : '—'}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                  {order.city_id ? (citiesById[order.city_id] ?? order.city_id.slice(0, 8)) : '—'}
                </td>
                <td className="px-4 py-3 text-xs font-semibold text-slate-800 whitespace-nowrap">
                  {fmtAmount(order.total_order_amount ?? order.total_amount)}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                  {fmtAmount(order.courier_payout ?? 0)}
                </td>
                <td className="px-4 py-3 text-xs text-emerald-700 font-medium whitespace-nowrap">
                  {fmtAmount((order.total_order_amount ?? order.total_amount ?? 0) - (order.courier_payout ?? 0))}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_BADGE[order.status] ?? 'slate'} dot>
                    {STATUS_LABELS[order.status] ?? order.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">
                  {fmtDate(order.created_at)}
                </td>
                <td className="px-4 py-3">
                  {onDetail && (
                    <button
                      onClick={() => onDetail(order)}
                      className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      <ExternalLink size={13} />
                      Открыть
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
