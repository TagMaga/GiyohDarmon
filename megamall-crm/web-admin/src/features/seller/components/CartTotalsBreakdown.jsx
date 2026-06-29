import { fmtAmount } from '../../../shared/orderStatusConfig'

export function calcCartOriginalTotal(items) {
  return items.reduce((acc, item) => {
    const qty = Number(item.quantity) || 0
    const unitPrice = Number(item.unit_price) || 0
    return acc + (qty * unitPrice)
  }, 0)
}

export function calcDiscountPercent(originalTotal, productTotal) {
  if (originalTotal <= 0) return 0
  const discountAmount = Math.max(0, originalTotal - productTotal)
  return (discountAmount / originalTotal) * 100
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return '0%'
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`
}

function money(value) {
  return `${fmtAmount(value)} с`
}

function deliveryValue(value) {
  return Number(value) <= 0 ? 'Бесплатно' : money(value)
}

function TotalRow({ label, value, valueClassName = 'text-slate-800', strong = false }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-xs ${strong ? 'font-semibold text-slate-700' : 'text-slate-500'}`}>
        {label}
      </span>
      <span className={`text-sm tabular-nums ${strong ? 'font-bold' : 'font-semibold'} ${valueClassName}`}>
        {value}
      </span>
    </div>
  )
}

export default function CartTotalsBreakdown({
  items = [],
  productTotal = 0,
  deliveryFee = 0,
  prepaymentAmount = 0,
  totalPayment = 0,
  amountToCollect,
}) {
  const originalTotal = calcCartOriginalTotal(items)
  const discountPercent = calcDiscountPercent(originalTotal, productTotal)
  const prepayment = Number(prepaymentAmount) || 0
  const orderTotal = Number(totalPayment) || 0
  const remaining = amountToCollect == null
    ? Math.max(0, orderTotal - prepayment)
    : Math.max(0, Number(amountToCollect) || 0)

  return (
    <div className="card p-4 space-y-2">
      <TotalRow label="Стоимость товаров" value={money(originalTotal)} />
      <TotalRow
        label="Скидка"
        value={formatPercent(discountPercent)}
        valueClassName={discountPercent > 0 ? 'text-rose-500' : 'text-slate-800'}
      />
      <TotalRow
        label="Доставка"
        value={deliveryValue(deliveryFee)}
        valueClassName={Number(deliveryFee) <= 0 ? 'text-emerald-600' : 'text-slate-800'}
      />
      <TotalRow
        label="Предоплата"
        value={prepayment > 0 ? `− ${money(prepayment)}` : money(0)}
        valueClassName={prepayment > 0 ? 'text-emerald-600' : 'text-slate-800'}
      />
<TotalRow
        label="Остаток к оплате"
        value={money(remaining)}
        valueClassName={remaining <= 0 ? 'text-emerald-600' : 'text-slate-900'}
        strong
      />
    </div>
  )
}
