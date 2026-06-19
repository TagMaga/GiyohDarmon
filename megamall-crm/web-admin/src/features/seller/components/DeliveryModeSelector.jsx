import { Truck, Zap } from 'lucide-react'

export const DELIVERY_MODES = [
  { key: 'normal', label: 'Обычная доставка' },
  { key: 'fast',   label: 'Быстрая доставка' },
]

/**
 * DeliveryModeSelector
 *
 * Props:
 *   mode       {string}  — 'normal' | 'fast'
 *   onChange   {fn}      — (mode) => void
 *   normalFee  {number}  — client fee from owner settings (0 = free)
 *   fastFee    {number}  — client fee from owner settings
 */
export default function DeliveryModeSelector({ mode, onChange, normalFee = 0, fastFee = 0 }) {
  const fmtFee = (f) => (f <= 0 ? 'Бесплатно' : `${f.toLocaleString('ru-RU')} сомони`)

  const options = [
    {
      key: 'normal',
      label: 'Обычная доставка',
      feeLabel: fmtFee(normalFee),
      Icon: Truck,
      active: { tile: 'border-slate-400 bg-slate-50 ring-2 ring-slate-400/20', icon: 'bg-slate-200 text-slate-600', label: 'text-slate-800' },
    },
    {
      key: 'fast',
      label: 'Быстрая доставка',
      feeLabel: fmtFee(fastFee),
      Icon: Zap,
      active: { tile: 'border-amber-400 bg-amber-50 ring-2 ring-amber-500/20', icon: 'bg-amber-100 text-amber-600', label: 'text-amber-800' },
    },
  ]

  return (
    <div className="space-y-2">
      <label className="input-label">Способ доставки *</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map(({ key, label, feeLabel, Icon, active: c }) => {
          const isActive = mode === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => onChange(key)}
              className={`text-left p-3 rounded-xl border transition-all
                ${isActive ? c.tile : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 transition-colors
                ${isActive ? c.icon : 'bg-slate-100 text-slate-400'}`}>
                <Icon size={14} />
              </div>
              <p className={`text-[11px] font-semibold leading-tight
                ${isActive ? c.label : 'text-slate-700'}`}>
                {label}
              </p>
              <p className={`text-[11px] font-bold mt-0.5 ${isActive ? c.label : 'text-slate-500'}`}>
                {feeLabel}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
