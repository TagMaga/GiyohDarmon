import { Minus, Plus } from 'lucide-react'

/**
 * QuantitySelector — +/- stepper with a min of 1.
 *
 * Props:
 *   value      {number}
 *   onChange   {fn}   — (qty: number) => void
 *   max        {number|null}  — optional max from inventory
 *   disabled   {bool}
 */
export default function QuantitySelector({ value = 1, onChange, max = null, disabled = false }) {
  const decrement = () => {
    if (value > 1) onChange(value - 1)
  }
  const increment = () => {
    if (max == null || value < max) onChange(value + 1)
  }

  return (
    <div className="space-y-2">
      <label className="input-label">Количество *</label>
      <div className="flex items-center gap-0">
        <button
          type="button"
          onClick={decrement}
          disabled={disabled || value <= 1}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-l-xl
                     border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Minus size={15} />
        </button>

        <input
          type="number"
          value={value}
          min={1}
          max={max ?? undefined}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v) && v >= 1) {
              if (max == null || v <= max) onChange(v)
            }
          }}
          disabled={disabled}
          className="w-16 min-h-[44px] border-y border-slate-200 text-center text-sm font-semibold
                     text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20
                     focus:border-indigo-400 bg-white disabled:bg-slate-50 disabled:opacity-60
                     [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none
                     [&::-webkit-outer-spin-button]:appearance-none"
        />

        <button
          type="button"
          onClick={increment}
          disabled={disabled || (max != null && value >= max)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-r-xl
                     border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100
                     disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Plus size={15} />
        </button>

        {max != null && (
          <span className="ml-3 text-xs text-slate-400">
            Доступно: <span className="font-semibold text-slate-600">{max}</span>
          </span>
        )}
      </div>
    </div>
  )
}
