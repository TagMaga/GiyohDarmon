import { useMemo, useState } from 'react'

function toYMD(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function fromYMD(value) {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function monthsBetween(a, b) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

function formatMonthLabel(date) {
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

function formatShort(value) {
  const date = fromYMD(value)
  if (!date) return ''
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export default function MobileDateRangeCalendar({ from, to, onChange, className = '' }) {
  const today = useMemo(() => new Date(), [])
  const fromDate = fromYMD(from)
  const toDate = fromYMD(to)

  const defaultFirst = useMemo(
    () => startOfMonth(addMonths(fromDate ?? toDate ?? today, -1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const defaultCount = useMemo(() => {
    const lastMonth = startOfMonth(toDate ?? fromDate ?? today)
    return Math.max(2, monthsBetween(defaultFirst, lastMonth) + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [firstMonth, setFirstMonth] = useState(defaultFirst)
  const [monthCount, setMonthCount] = useState(defaultCount)

  const months = useMemo(
    () => Array.from({ length: monthCount }, (_, i) => addMonths(firstMonth, i)),
    [firstMonth, monthCount]
  )

  function pickDay(day) {
    const value = toYMD(day)
    if (!from || (from && to)) {
      onChange({ from: value, to: '' })
      return
    }
    if (value < from) {
      onChange({ from: value, to: from })
      return
    }
    onChange({ from, to: value })
  }

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-bold text-slate-500">
        {from && to ? `${formatShort(from)} – ${formatShort(to)}` : from ? `${formatShort(from)} – …` : 'Выберите период'}
      </p>

      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map(day => (
          <div key={day} className="py-1 text-[10px] font-bold text-slate-400">{day}</div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => { setFirstMonth(m => addMonths(m, -1)); setMonthCount(c => c + 1) }}
        className="w-full rounded-lg py-1.5 text-center text-[11px] font-bold text-indigo-600 hover:bg-indigo-50"
      >
        Показать более ранний месяц
      </button>

      <div className="max-h-[320px] overflow-y-auto">
        {months.map((month, i) => (
          <MonthSection key={i} month={month} from={from} to={to} onPick={pickDay} />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setMonthCount(c => c + 1)}
        className="w-full rounded-lg py-1.5 text-center text-[11px] font-bold text-indigo-600 hover:bg-indigo-50"
      >
        Показать следующий месяц
      </button>
    </div>
  )
}

function MonthSection({ month, from, to, onPick }) {
  const days = useMemo(() => {
    const first = startOfMonth(month)
    const offset = (first.getDay() + 6) % 7
    const cells = []
    for (let i = 0; i < offset; i += 1) cells.push(null)
    const total = endOfMonth(month).getDate()
    for (let day = 1; day <= total; day += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), day))
    return cells
  }, [month])

  return (
    <div className="pt-2 pb-1">
      <p className="mb-1.5 text-xs font-bold capitalize text-slate-700">{formatMonthLabel(month)}</p>
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="h-9" />
          const value = toYMD(day)
          const isEdge = value === from || value === to
          const inRange = Boolean(from && to && value > from && value < to)
          const isToday = value === toYMD(new Date())
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPick(day)}
              className={[
                'h-9 w-full text-xs font-semibold transition-colors',
                isEdge ? 'rounded-full bg-indigo-600 text-white' : inRange ? 'bg-indigo-50 text-indigo-700' : isToday ? 'rounded-full text-indigo-700 ring-1 ring-indigo-200 hover:bg-slate-100' : 'rounded-full text-slate-700 hover:bg-slate-100',
              ].join(' ')}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
