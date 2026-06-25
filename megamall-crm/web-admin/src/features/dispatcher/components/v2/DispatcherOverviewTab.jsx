import { useState } from 'react'
import { User, Phone, MapPin, Package, Banknote, Truck } from 'lucide-react'
import Skeleton from '../../../../shared/components/Skeleton'
import { fmtDate } from '../../statusConfig'
import { resolveCustomer, resolveAddress, resolveCity } from '../../utils/resolveCustomer'
import { resolveCourier, resolveCourierDisplay, getCourierId } from '../../utils/orderHelpers'
import DispatcherCommentsSummary from './DispatcherCommentsSummary'
import DispatcherCommentsSheet   from './DispatcherCommentsSheet'

const fmt = (v) => v == null ? '—' : Number(v).toLocaleString('ru-RU', { maximumFractionDigits: 0 })

function initials(name = '') {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0][0] ?? '?').toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
const AVATAR_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6']
function avatarColor(name = '') {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

export default function DispatcherOverviewTab({ order, courierMap = {}, comments = [], onAction, loading }) {
  const [commentsOpen, setCommentsOpen] = useState(false)
  const orderId = order?.id ?? order?.order_id

  if (loading && !order?.customer) {
    return (
      <div className="p-5 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
      </div>
    )
  }

  const customer      = resolveCustomer(order, {})
  const address       = resolveAddress(order)
  const city          = resolveCity(order)
  const fullAddress   = [address, city].filter(Boolean).join(', ')
  const customerNote  = order.notes ?? order.comment ?? order.customer_comment

  const productTotal  = Number(order.total_amount ?? 0)
  const deliveryFee   = Number(order.delivery_fee ?? 0)
  const totalOrderAmt = Number(order.total_order_amount ?? productTotal + deliveryFee)
  const prepayAmt     = Number(order.prepayment_amount ?? 0)
  const toCollect     = Number(order.amount_to_collect ?? Math.max(0, totalOrderAmt - prepayAmt))
  const isCash        = order.payment_method === 'cash' || order.payment_method === 'наличные'

  const items         = Array.isArray(order.items) ? order.items : Array.isArray(order.order_items) ? order.order_items : []
  const courier       = resolveCourier(order, courierMap)
  const courierDisp   = resolveCourierDisplay(order, courierMap)
  const courierId     = getCourierId(order)
  const courierData   = courierId ? courierMap[courierId] : null

  const canAssign     = ['new', 'confirmed'].includes(order.status)
  const canReassign   = ['assigned', 'in_delivery', 'issue'].includes(order.status)

  const sellerName = order.seller?.full_name ?? order.seller_name ?? null

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-6">

          {/* ── Customer ────────────────────────────────── */}
          <section>
            <SectionHead>Клиент</SectionHead>
            <div className="space-y-2">
              <InfoRow icon={User}   value={customer.full_name || '—'} />
              {customer.phone && (
                <a href={`tel:${customer.phone}`} className="block">
                  <InfoRow icon={Phone} value={customer.phone} blue />
                </a>
              )}
              {fullAddress && <InfoRow icon={MapPin} value={fullAddress} />}
              {customerNote && (
                <div className="flex items-start gap-2 mt-1.5 bg-amber-50 rounded-xl px-3 py-2">
                  <span className="text-amber-500 text-sm flex-shrink-0 mt-0.5">💬</span>
                  <p className="text-xs text-amber-800">{customerNote}</p>
                </div>
              )}
            </div>
          </section>

          {/* ── Products ────────────────────────────────── */}
          {items.length > 0 && (
            <section>
              <SectionHead>Товары ({items.length})</SectionHead>
              <div className="bg-slate-50 rounded-xl divide-y divide-slate-100">
                {items.map((item, i) => (
                  <div key={item.id ?? i} className="flex items-center justify-between px-3 py-2">
                    <span className="text-xs text-slate-700 truncate flex-1 mr-2">
                      {item.product_name ?? item.name ?? `Товар ${i + 1}`}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10px] text-slate-400">×{item.quantity ?? 1}</span>
                      {item.price != null && (
                        <span className="text-xs font-semibold text-slate-700">{fmt(item.price)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Delivery ────────────────────────────────── */}
          {(order.delivery_method || order.scheduled_at || order.delivery_date) && (
            <section>
              <SectionHead>Доставка</SectionHead>
              <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-1.5">
                {order.delivery_method && (
                  <FinRow label="Способ" value={order.delivery_method} />
                )}
                {(order.scheduled_at || order.delivery_date) && (
                  <FinRow
                    label="Дата"
                    value={fmtDate(order.scheduled_at ?? order.delivery_date)}
                  />
                )}
                {deliveryFee > 0 && (
                  <FinRow label="Тариф" value={`${fmt(deliveryFee)} сом`} />
                )}
              </div>
            </section>
          )}

          {/* ── Finance ─────────────────────────────────── */}
          <section>
            <SectionHead>Финансы</SectionHead>
            <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-1.5">
              {productTotal > 0 && deliveryFee > 0 && (
                <FinRow label="Товары" value={`${fmt(productTotal)} сом`} />
              )}
              {deliveryFee > 0 && (
                <FinRow label="Доставка" value={`${fmt(deliveryFee)} сом`} />
              )}
              <FinRow label="Итого" value={`${fmt(totalOrderAmt)} сом`} bold />
              {order.payment_method && (
                <FinRow label="Оплата" value={order.payment_method} />
              )}
              {isCash && toCollect > 0 && (
                <FinRow
                  label="К получению"
                  value={`${fmt(toCollect)} сом`}
                  accent="text-amber-700"
                />
              )}
              {prepayAmt > 0 && (
                <FinRow label="Предоплата" value={`${fmt(prepayAmt)} сом`} />
              )}
            </div>
          </section>

          {/* ── Assignment ──────────────────────────────── */}
          <section>
            <SectionHead>Курьер</SectionHead>

            {courier ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                    style={{ background: avatarColor(courier.full_name ?? '') }}
                  >
                    {initials(courier.full_name ?? '')}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{courier.full_name}</p>
                    {courierData && (
                      <p className="text-[10px] text-slate-400">
                        {courierData.active_orders ?? 0} заказов
                        {Number(courierData.cash_owed ?? 0) > 0 && (
                          <span className="text-amber-600 ml-1">
                            · {fmt(courierData.cash_owed)} сом долг
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                {canReassign && (
                  <button
                    onClick={() => onAction('reassign', order)}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
                  >
                    Сменить
                  </button>
                )}
              </div>
            ) : canAssign ? (
              <button
                onClick={() => onAction(order.status === 'new' ? 'confirm' : 'assign', order)}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800 transition-colors"
              >
                <Truck size={14} />
                {order.status === 'new' ? 'Подтвердить заказ' : 'Назначить курьера'}
              </button>
            ) : (
              <p className="text-sm text-slate-400">Не назначен</p>
            )}
          </section>

          {/* ── Seller ──────────────────────────────────── */}
          {sellerName && (
            <section>
              <SectionHead>Продавец</SectionHead>
              <p className="text-sm text-slate-700 font-medium">{sellerName}</p>
            </section>
          )}

          {/* ── Latest comment ──────────────────────────── */}
          <DispatcherCommentsSummary
            comments={comments}
            onShowAll={() => setCommentsOpen(true)}
          />
        </div>
      </div>

      {/* Comments bottom sheet */}
      {commentsOpen && (
        <DispatcherCommentsSheet
          orderId={orderId}
          onClose={() => setCommentsOpen(false)}
        />
      )}
    </>
  )
}

function SectionHead({ children }) {
  return (
    <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
      {children}
    </h3>
  )
}

function InfoRow({ icon: Icon, value, blue }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={13} className={`flex-shrink-0 ${blue ? 'text-indigo-400' : 'text-slate-400'}`} />
      <span className={`text-sm ${blue ? 'text-indigo-600 font-medium' : 'text-slate-700'}`}>{value}</span>
    </div>
  )
}

function FinRow({ label, value, bold, accent }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm ${bold ? 'font-bold text-slate-800' : accent ?? 'text-slate-600'}`}>
        {value}
      </span>
    </div>
  )
}
