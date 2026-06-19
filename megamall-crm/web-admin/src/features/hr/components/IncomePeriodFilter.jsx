/**
 * IncomePeriodFilter — compact period selector: preset chips + custom date range.
 *
 * Props:
 *   from      {string}  YYYY-MM-DD
 *   to        {string}  YYYY-MM-DD
 *   onChange  {fn}      (from, to) => void
 */
import { useState } from 'react'
import { CalendarDays } from 'lucide-react'

function toYMD(date) {
  return date.toISOString().slice(0, 10)
}

function currentMonthRange() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return { from: toYMD(start), to: toYMD(end) }
}

function prevMonthRange() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end   = new Date(now.getFullYear(), now.getMonth(), 0)
  return { from: toYMD(start), to: toYMD(end) }
}

function last7Range() {
  const now   = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - 6)
  return { from: toYMD(start), to: toYMD(now) }
}

const PRESETS = [
  { label: 'Этот месяц', fn: currentMonthRange },
  { label: 'Прошлый',    fn: prevMonthRange },
  { label: '7 дней',     fn: last7Range },
]

export default function IncomePeriodFilter({ from, to, onChange }) {
  const [showCustom, setShowCustom] = useState(false)
  const [customFrom, setCustomFrom] = useState(from ?? '')
  const [customTo,   setCustomTo]   = useState(to   ?? '')

  function applyPreset(preset) {
    const r = preset.fn()
    setCustomFrom(r.from)
    setCustomTo(r.to)
    setShowCustom(false)
    onChange(r.from, r.to)
  }

  function applyCustom() {
    if (customFrom && customTo) {
      onChange(customFrom, customTo)
      setShowCustom(false)
    }
  }

  // Detect which preset is active
  function isActive(preset) {
    const r = preset.fn()
    return r.from === from && r.to === to
  }

  return (
    <div className="space-y-2">
      {/* Preset chips */}
      <div className="flex flex-wrap gap-2 items-center">
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => applyPreset(p)}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-semibold transition-all min-h-[36px]',
              isActive(p)
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            ].join(' ')}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(v => !v)}
          className={[
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all min-h-[36px]',
            showCustom
              ? 'bg-indigo-100 text-indigo-700'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
          ].join(' ')}
        >
          <CalendarDays size={12} />
          Произвольный
        </button>
      </div>

      {/* Current range label */}
      {from && to && (
        <p className="text-xs text-slate-400">
          {new Date(from).toLocaleDateString('ru-RU')} — {new Date(to).toLocaleDateString('ru-RU')}
        </p>
      )}

      {/* Custom date inputs */}
      {showCustom && (
        <div className="flex flex-wrap gap-2 items-end pt-1">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">С</label>
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="input text-sm h-9 px-2 w-36"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">По</label>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="input text-sm h-9 px-2 w-36"
            />
          </div>
          <button
            onClick={applyCustom}
            disabled={!customFrom || !customTo}
            className="btn-primary h-9 px-4 text-sm disabled:opacity-40"
          >
            Применить
          </button>
        </div>
      )}
    </div>
  )
}
