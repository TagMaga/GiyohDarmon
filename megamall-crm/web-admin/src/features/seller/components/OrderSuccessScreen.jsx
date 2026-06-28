import { CheckCircle2, AlertTriangle, Plus, Package, User, MapPin, CreditCard, Copy, Phone, MessageCircle } from 'lucide-react'
import { fmtAmount } from '../../../shared/orderStatusConfig'
import { DELIVERY_MODES } from './DeliveryModeSelector'
import { calcCartOriginalTotal } from './CartTotalsBreakdown'

function money(val) {
  return `${fmtAmount(val)} с`
}

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
  fullName = '',
  phone = '',
  city = '',
  address = '',
  onCreateAnother,
}) {
  const deliveryLabel = DELIVERY_MODES.find((m) => m.key === deliveryMode)?.label ?? 'Обычная доставка'
  const amountToCollect = Math.max(0, displayTotal - prepayAmount)
  const originalTotal = calcCartOriginalTotal(cartItems)
  const discountAmount = Math.max(0, originalTotal - subtotal)
  const discountPct = originalTotal > 0 ? Math.round((discountAmount / originalTotal) * 100) : 0
  const fullAddress = [address, city].filter(Boolean).join(', ')

  const copyOrderNumber = () => {
    if (order?.order_number) navigator.clipboard.writeText(order.order_number).catch(() => {})
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8 space-y-4">
      {/* Header */}
      <div className="flex flex-col items-center text-center mb-2">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
          <CheckCircle2 size={32} className="text-emerald-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Заказ создан!</h2>
        {order?.order_number && (
          <button
            type="button"
            onClick={copyOrderNumber}
            className="flex items-center gap-1.5 mt-1 text-sm font-mono font-bold text-slate-700 hover:text-indigo-600 transition-colors"
          >
            {order.order_number}
            <Copy size={13} className="text-slate-400" />
          </button>
        )}
      </div>

      {/* Prepayment warning */}
      {prepayWarning && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-2xl">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-800">Предоплата не сохранена</p>
            <p className="text-xs text-amber-700 mt-0.5">Заказ создан, но предоплату не удалось записать. Добавьте оплату позже.</p>
          </div>
        </div>
      )}

      {/* Customer info card */}
      <div className="card divide-y divide-slate-100">
        {/* Customer */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <User size={16} className="text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-slate-400 font-medium">Клиент</p>
            <p className="text-sm font-semibold text-slate-800 truncate">
              {fullName || '—'}{phone ? <span className="text-slate-400 font-normal ml-2">{phone}</span> : null}
            </p>
          </div>
          {phone && (
            <div className="flex gap-1.5">
              <a href={`tel:${phone}`}
                className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center hover:bg-indigo-100 transition-colors">
                <Phone size={14} className="text-indigo-500" />
              </a>
              <a href={`https://wa.me/${phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center hover:bg-emerald-100 transition-colors">
                <MessageCircle size={14} className="text-emerald-500" />
              </a>
            </div>
          )}
        </div>

        {/* Address */}
        {fullAddress && (
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
              <MapPin size={16} className="text-indigo-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 font-medium">Адрес доставки</p>
              <p className="text-sm font-semibold text-slate-800">{fullAddress}</p>
            </div>
          </div>
        )}

        {/* Payment */}
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <CreditCard size={16} className="text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-slate-400 font-medium">Способ оплаты</p>
            <p className="text-sm font-semibold text-slate-800">
              {payMode === 'cod' ? 'Оплата при получении' : 'Предоплата'}
            </p>
          </div>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600">
            {payMode === 'cod' ? 'Наличные' : 'Предоплата'}
          </span>
        </div>
      </div>

      {/* Products */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50/70">
          <span className="text-xs font-semibold text-slate-600">Товары</span>
          <span className="text-xs text-slate-400 bg-white border border-slate-200 rounded-full px-2.5 py-0.5">
            {cartItems.length} {cartItems.length === 1 ? 'товар' : cartItems.length < 5 ? 'товара' : 'товаров'}
          </span>
        </div>
        {cartItems.map((it, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0">
            {it.product_image_url ? (
              <img src={it.product_image_url} alt={it.name}
                className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Package size={16} className="text-indigo-400" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{it.name}</p>
              <p className="text-xs text-slate-400">{it.quantity} × {money(it.unit_price)}</p>
            </div>
            <span className="text-sm font-bold text-slate-800 flex-shrink-0">{money(it.total_price)}</span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="card px-4 py-4 space-y-2.5">
        <div className="flex justify-between text-sm text-slate-500">
          <span>Стоимость товаров</span>
          <span className="font-semibold text-slate-800">{money(subtotal)}</span>
        </div>
        {discountPct > 0 && (
          <div className="flex justify-between text-sm text-slate-500">
            <span>Скидка</span>
            <span className="font-semibold text-rose-500">{discountPct}%</span>
          </div>
        )}
        <div className="flex justify-between text-sm text-slate-500">
          <span>Доставка</span>
          <span className={`font-semibold ${deliveryExtra > 0 ? 'text-slate-800' : 'text-emerald-600'}`}>
            {deliveryExtra > 0 ? money(deliveryExtra) : 'Бесплатно'}
          </span>
        </div>
        {prepayAmount > 0 && (
          <div className="flex justify-between text-sm text-slate-500">
            <span>Предоплата</span>
            <span className="font-semibold text-emerald-600">− {money(prepayAmount)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm font-bold text-slate-900 pt-2 border-t border-slate-100">
          <span>Остаток к оплате</span>
          <span>{money(amountToCollect)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onCreateAnother}
          className="flex-1 btn btn-primary btn-md flex items-center justify-center gap-2"
        >
          <Plus size={16} />
          Новый заказ
        </button>
      </div>
    </div>
  )
}
