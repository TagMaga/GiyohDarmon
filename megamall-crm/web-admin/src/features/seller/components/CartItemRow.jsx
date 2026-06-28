import { Minus, Plus, Trash2 } from 'lucide-react'
import { fmtAmount } from '../../../shared/orderStatusConfig'

export default function CartItemRow({ item, onChange, onRemove }) {
  const originalTotal = item.unit_price * item.quantity
  const discount = originalTotal - (item.total_price ?? originalTotal)

  const setQty = (qty) => {
    if (qty < 1) return
    // reset total_price to original when qty changes
    onChange({ ...item, quantity: qty, total_price: item.unit_price * qty })
  }

  const setTotalPrice = (val) => {
    const price = val === '' ? 0 : Number(val)
    onChange({ ...item, total_price: price })
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5 overflow-hidden">
        {item.product_image_url ? (
          <img
            src={item.product_image_url}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-sm font-bold text-slate-400">
            {item.name?.charAt(0)?.toUpperCase() ?? '?'}
          </span>
        )}
      </div>

      {/* Info + controls */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 leading-tight truncate">
              {item.name}
            </p>
            {item.sku && (
              <p className="text-[10px] text-slate-400">{item.sku}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="min-w-[36px] min-h-[36px] flex items-center justify-center
                       rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50
                       transition-colors flex-shrink-0"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* Qty + price row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Read-only unit price */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400 whitespace-nowrap">Цена:</span>
            <span className="text-xs font-semibold text-slate-500">
              {fmtAmount(item.unit_price)}
            </span>
          </div>

          {/* Quantity stepper */}
          <div className="flex items-center gap-0">
            <button
              type="button"
              onClick={() => setQty(item.quantity - 1)}
              disabled={item.quantity <= 1}
              className="w-8 h-8 flex items-center justify-center rounded-l-lg border border-slate-200
                         bg-slate-50 text-slate-600 hover:bg-slate-100
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Minus size={12} />
            </button>
            <div className="w-9 h-8 border-y border-slate-200 flex items-center justify-center
                            text-xs font-semibold text-slate-800 bg-white">
              {item.quantity}
            </div>
            <button
              type="button"
              onClick={() => setQty(item.quantity + 1)}
              className="w-8 h-8 flex items-center justify-center rounded-r-lg border border-slate-200
                         bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <Plus size={12} />
            </button>
          </div>

          {/* Editable total price */}
          <div className="flex items-center gap-1 ml-auto">
            {discount > 0 && (
              <span className="text-[10px] text-rose-500 font-semibold whitespace-nowrap">
                −{fmtAmount(discount)}
              </span>
            )}
            <div className="relative">
              <input
                type="number"
                value={item.total_price === 0 ? '' : item.total_price}
                onChange={(e) => setTotalPrice(e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
                className="w-24 h-8 px-2 pr-5 rounded-lg border border-slate-200 text-xs font-bold
                           text-indigo-600 text-right focus:outline-none focus:ring-2 focus:ring-indigo-400/30
                           focus:border-indigo-400 bg-white
                           [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
                           [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">с</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
