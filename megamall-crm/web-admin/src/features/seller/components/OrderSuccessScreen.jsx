import { CheckCircle2, AlertTriangle, Plus, Package } from 'lucide-react'
import { fmtAmount } from '../../../shared/orderStatusConfig'
import { DELIVERY_MODES } from './DeliveryModeSelector'

/**
 * OrderSuccessScreen
 *
 * Props:
 *   order         {object}   — created order
 *   cartItems     {Array}    — [{ name, quantity, unit_price, total_price }]
 *   subtotal      {number}
 *   deliveryExtra {number}   — 0 or 20
 *   deliveryMode  {string}
 *   displayTotal  {number}   — subtotal + deliveryExtra
 *   prepayAmount  {number}   — 0 if COD
 *   payMode       {string}
 *   prepayWarning {bool}
 *   onCreateAnother {fn}
 */
export default function OrderSuccessScreen({
  order,
  cartItems = [],
  subtotal = 0,
  deliveryExtra = 0,
  deliveryMode = 'standard',
  displayTotal = 0,
  prepayAmount = 0,
  payMode = 'cod',
  prepayWarning = false,
  onCreateAnother,
}) {
  const deliveryLabel = DELIVERY_MODES.find((m) => m.key === deliveryMode)?.label ?? deliveryMode
  const remaining = displayTotal - prepayAmount

  return (
    <div className="max-w-md mx-auto px-4 py-10 space-y-6">
      {/* Header */}
      <div className="flex flex-col items-center text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-4 shadow-lg">
          <CheckCircle2 size={40} className="text-emerald-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Заказ создан!</h2>
        {order?.order_number && (
          <p className="text-sm text-slate-500 mt-1">
            <span className="font-mono font-bold text-slate-800">{order.order_number}</span>
          </p>
        )}
      </div>

      {/* Prepayment warning */}
      {prepayWarning && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-2xl">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-800">Предоплата не сохранена</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Заказ создан, но предоплату не удалось записать. Добавьте оплату позже.
            </p>
          </div>
        </div>
      )}

      {/* Products list */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
          <span className="text-xs font-semibold text-slate-600">Товары</span>
        </div>
        {cartItems.map((it, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0">
            {it.product_image_url ? (
              <img src={it.product_image_url} alt={it.name}
                className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Package size={13} className="text-indigo-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">{it.name}</p>
              <p className="text-[10px] text-slate-400">{it.quantity} × {fmtAmount(it.unit_price)}</p>
            </div>
            <span className="text-sm font-bold text-slate-800 flex-shrink-0">
              {fmtAmount(it.total_price)}
            </span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="card px-4 py-4 space-y-2">
        <div className="flex justify-between text-xs text-slate-500">
          <span>Подытог</span>
          <span className="font-semibold text-slate-700">{fmtAmount(subtotal)}</span>
        </div>
        <div className="flex justify-between text-xs text-slate-500">
          <span>Доставка</span>
          <span className="font-semibold text-slate-700">
            {deliveryLabel}{deliveryExtra > 0 ? ` (+${deliveryExtra} с)` : ''}
          </span>
        </div>
        <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-100">
          <span>Итого к оплате</span>
          <span className="text-indigo-600">{fmtAmount(displayTotal)}</span>
        </div>
        {payMode !== 'cod' && prepayAmount > 0 && (
          <>
            <div className="flex justify-between text-xs text-emerald-600">
              <span>Предоплата</span>
              <span className="font-semibold">− {fmtAmount(prepayAmount)}</span>
            </div>
            <div className="flex justify-between text-xs font-semibold text-slate-700">
              <span>Остаток при получении</span>
              <span>{fmtAmount(Math.max(remaining, 0))}</span>
            </div>
          </>
        )}
        {payMode === 'cod' && (
          <p className="text-[11px] text-slate-400 pt-1">Оплата при получении</p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={onCreateAnother}
          className="btn btn-primary btn-md w-full flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          Новый заказ
        </button>
      </div>
    </div>
  )
}
