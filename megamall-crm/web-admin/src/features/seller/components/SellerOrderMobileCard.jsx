import { Link } from 'react-router-dom'
import EmptyState from '../../../shared/components/EmptyState'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'
import { ClipboardList, Phone } from 'lucide-react'
import { M, Card, StatusPill, PrimaryButton } from './mobileUi'

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
      <div className="space-y-[10px]">
        {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-[120px] animate-pulse" />)}
      </div>
    )
  }

  if (orders.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<ClipboardList size={24} />}
          title="Нет заказов"
          description="Ваши заказы появятся здесь после создания."
          action={showCreate
            ? (
              <Link to="/seller/orders/create" className="inline-block">
                <PrimaryButton as="span" style={{ pointerEvents: 'none' }}>Создать заказ</PrimaryButton>
              </Link>
            )
            : null}
        />
      </Card>
    )
  }

  return (
    <div className="space-y-[10px]">
      {orders.map(order => (
        <Card key={order.id} className="p-[15px] active:scale-[0.99] transition-transform">
          {/* Top: number + customer + phone | status + amount */}
          <div className="flex items-start justify-between gap-[10px]">
            <div className="min-w-0">
              <p style={{ fontSize: 11, fontWeight: 700, color: M.faint, letterSpacing: '.03em', fontVariantNumeric: 'tabular-nums' }}>
                {order.order_number ?? order.id?.slice(0, 8)}
              </p>
              <p className="truncate" style={{ fontSize: 15, fontWeight: 700, color: M.ink, marginTop: 3 }}>
                {order.customer?.full_name ?? '—'}
              </p>
              {order.customer?.phone && (
                <p style={{ fontSize: 12.5, color: M.muted, marginTop: 3 }}>{order.customer.phone}</p>
              )}
              <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6 }}>
                {order.city_id && citiesById[order.city_id] && (
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: '#76766E', background: '#F0EFEA', padding: '2px 8px', borderRadius: 7 }}>
                    {citiesById[order.city_id]}
                  </span>
                )}
                <span style={{ fontSize: 11.5, color: M.muted, fontWeight: 500 }}>{fmtDate(order.created_at)}</span>
              </div>
              {order.delivery_address && (
                <p className="truncate" style={{ fontSize: 12, color: M.sub, marginTop: 4 }}>{order.delivery_address}</p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <StatusPill status={order.status} />
              <div style={{ fontSize: 16, fontWeight: 800, color: M.ink, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                {fmtAmount(order.total_order_amount ?? order.total_amount)} с
              </div>
              {order.net_revenue != null && (
                <p style={{ fontSize: 11, fontWeight: 700, color: M.green, marginTop: 2 }}>
                  +{fmtAmount(order.net_revenue)} чистая
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2" style={{ marginTop: 13 }}>
            {order.customer?.phone && (
              <a
                href={`tel:${order.customer.phone}`}
                onClick={e => e.stopPropagation()}
                className="flex-1 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                style={{ background: '#EAF6EF', color: M.green, fontSize: 13, fontWeight: 700, padding: 10, borderRadius: 11, minHeight: 40 }}
              >
                <Phone size={14} />
                Позвонить
              </a>
            )}
            {onDetail && (
              <button
                onClick={() => onDetail(order)}
                className="flex-1 flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
                style={{ background: '#EEEDFB', color: M.indigoDeep, border: 'none', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, padding: 10, borderRadius: 11, minHeight: 40, cursor: 'pointer' }}
              >
                Детали →
              </button>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
