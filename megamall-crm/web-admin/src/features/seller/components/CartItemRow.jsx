import { Minus, Plus, Trash2 } from 'lucide-react'
import { fmtAmount } from '../../../shared/orderStatusConfig'

/**
 * CartItemRow — one line in the cart.
 *
 * Props:
 *   item      { product_id, name, sku, quantity, unit_price, total_price }
 *   onChange  fn(updatedItem)  — call with updated item
 *   onRemove  fn()
 */
export default function CartItemRow({ item, onChange, onRemove }) {
  const setQty = (qty) => {
    if (qty < 1) return
    onChange({ ...item, quantity: qty, total_price: qty * item.unit_price })
  }

  const setUnitPrice = (val) => {
    const price = val === '' ? 0 : Number(val)
    onChange({ ...item, unit_price: price, total_price: price * item.quantity })
  }

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
      {/* Product icon placeholder */}
      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-sm font-bold text-slate-400">
          {item.name?.charAt(0)?.toUpperCase() ?? '?'}
        </span>
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
          {/* Remove */}
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

        {/* Price + qty row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Unit price */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-400 whitespace-nowrap">Цена:</span>
            <div className="relative">
              <input
                type="number"
                value={item.unit_price === 0 ? '' : item.unit_price}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0"
                min="0"
                step="0.01"
                className="w-20 h-8 px-2 pr-5 rounded-lg border border-slate-200 text-xs font-semibold
                           text-slate-800 text-right focus:outline-none focus:ring-2 focus:ring-indigo-400/30
                           focus:border-indigo-400 bg-white
                           [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
                           [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">с</span>
            </div>
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

          {/* Line total */}
          <span className="ml-auto text-sm font-bold text-indigo-600 whitespace-nowrap">
            {fmtAmount(item.total_price)}
          </span>
        </div>
      </div>
    </div>
  )
}
