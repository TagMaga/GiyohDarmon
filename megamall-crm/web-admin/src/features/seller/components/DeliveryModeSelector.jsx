import { M } from './mobileUi'

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
    { key: 'normal', label: 'Обычная', sub: `1–2 дня · ${fmtFee(normalFee)}` },
    { key: 'fast',   label: 'Срочная', sub: `Сегодня · ${fmtFee(fastFee)}` },
  ]

  return (
    <div className="flex gap-[9px]">
      {options.map(({ key, label, sub }) => {
        const isActive = mode === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className="flex-1 text-left relative transition-all active:scale-[0.98]"
            style={{
              border: isActive ? `1.5px solid ${M.indigo}` : `1.5px solid ${M.borderAlt}`,
              background: isActive ? '#F5F4FE' : '#fff',
              borderRadius: 13, padding: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {isActive ? (
              <div className="absolute flex items-center justify-center" style={{ top: 10, right: 10, width: 16, height: 16, borderRadius: '50%', background: M.indigo }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
            ) : (
              <div className="absolute" style={{ top: 10, right: 10, width: 16, height: 16, borderRadius: '50%', border: '1.5px solid #D6D4CC' }} />
            )}
            <div style={{ fontSize: 13.5, fontWeight: 700, color: M.ink }}>{label}</div>
            <div style={{ fontSize: 12, color: '#76766E', marginTop: 2 }}>{sub}</div>
          </button>
        )
      })}
    </div>
  )
}
