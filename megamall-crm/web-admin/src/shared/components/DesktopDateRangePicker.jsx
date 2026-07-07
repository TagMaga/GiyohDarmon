import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'

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

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1)
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

function formatShort(value) {
  const date = fromYMD(value)
  if (!date) return ''
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDMY(value) {
  const date = fromYMD(value)
  if (!date) return ''
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${date.getFullYear()}`
}

function formatMonth(date) {
  return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

function resolvePreset(value) {
  const today = new Date()
  const ymdToday = toYMD(today)
  const yesterday = toYMD(addDays(today, -1))

  switch (value) {
    case 'today':
      return { from: ymdToday, to: ymdToday }
    case 'yesterday':
      return { from: yesterday, to: yesterday }
    case 'last_2_days':
      return { from: yesterday, to: ymdToday }
    case 'last7':
    case 'last_7d':
      return { from: toYMD(addDays(today, -6)), to: ymdToday }
    case 'last14':
      return { from: toYMD(addDays(today, -13)), to: ymdToday }
    case 'last30':
      return { from: toYMD(addDays(today, -29)), to: ymdToday }
    case 'month':
    case 'this_month':
      return { from: toYMD(startOfMonth(today)), to: ymdToday }
    case 'prevMonth': {
      const prev = addMonths(today, -1)
      return { from: toYMD(startOfMonth(prev)), to: toYMD(endOfMonth(prev)) }
    }
    case 'all':
    case 'maximum':
      return { from: '', to: '' }
    default:
      return null
  }
}

function presetFromRange(from, to) {
  return DATE_PRESETS.find((preset) => {
    const range = resolvePreset(preset.value)
    return range && range.from === (from ?? '') && range.to === (to ?? '')
  })?.value ?? 'custom'
}

const DATE_PRESETS = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: 'last_2_days', label: 'Сегодня или вчера' },
  { value: 'last_7d', label: 'Последние 7 дн.' },
  { value: 'last14', label: 'Последние 14 дн.' },
  { value: 'last30', label: 'Последние 30 дн.' },
  { value: 'this_month', label: 'Этот месяц' },
  { value: 'prevMonth', label: 'Прошлый месяц' },
  { value: 'maximum', label: 'Максимум' },
]

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export default function DesktopDateRangePicker({
  from,
  to,
  onChange,
  onClear,
  variant = 'button', // 'button' (default light trigger) | 'chip' (dark pill with clear ✕, always visible)
  className = '',
  buttonClassName = '',
  align = 'left',
  timezoneLabel = 'Часовой пояс: локальное время',
}) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from ?? '')
  const [draftTo, setDraftTo] = useState(to ?? '')
  const [baseMonth, setBaseMonth] = useState(() => startOfMonth(fromYMD(from) ?? new Date()))
  const [panelOffset, setPanelOffset] = useState(0)
  const popoverRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handlePointer = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    return () => document.removeEventListener('mousedown', handlePointer)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const margin = 16

    function reposition() {
      const wrapper = popoverRef.current
      const panel = panelRef.current
      if (!wrapper || !panel) return
      const wrapperRect = wrapper.getBoundingClientRect()
      const panelWidth = panel.getBoundingClientRect().width
      const viewportWidth = window.innerWidth

      let desiredLeft = align === 'right' ? wrapperRect.width - panelWidth : 0
      let viewportLeft = wrapperRect.left + desiredLeft
      if (viewportLeft < margin) viewportLeft = margin
      if (viewportLeft + panelWidth > viewportWidth - margin) viewportLeft = viewportWidth - margin - panelWidth

      setPanelOffset(viewportLeft - wrapperRect.left)
    }

    reposition()
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [open, align])

  useEffect(() => {
    if (!open) {
      setDraftFrom(from ?? '')
      setDraftTo(to ?? '')
      setBaseMonth(startOfMonth(fromYMD(from) ?? new Date()))
    }
  }, [from, to, open])

  const activePreset = useMemo(() => presetFromRange(draftFrom, draftTo), [draftFrom, draftTo])
  const label = useMemo(() => {
    const preset = DATE_PRESETS.find((item) => item.value === presetFromRange(from, to))
    if (preset && preset.value !== 'maximum') return preset.label
    if (from && to) return `${formatShort(from)} - ${formatShort(to)}`
    return 'Максимум'
  }, [from, to])

  function applyPreset(value) {
    const range = resolvePreset(value)
    if (!range) return
    setDraftFrom(range.from)
    setDraftTo(range.to)
    if (range.from) setBaseMonth(startOfMonth(fromYMD(range.from)))
  }

  function pickDay(day) {
    const value = toYMD(day)
    if (!draftFrom || (draftFrom && draftTo)) {
      setDraftFrom(value)
      setDraftTo('')
      return
    }
    if (value < draftFrom) {
      setDraftTo(draftFrom)
      setDraftFrom(value)
      return
    }
    setDraftTo(value)
  }

  function apply() {
    onChange({ from: draftFrom, to: draftTo, preset: activePreset })
    setOpen(false)
  }

  function cancel() {
    setDraftFrom(from ?? '')
    setDraftTo(to ?? '')
    setOpen(false)
  }

  function clear() {
    if (onClear) onClear()
    else onChange({ from: '', to: '' })
  }

  const chipLabel = useMemo(() => {
    if (from && to) return `${formatDMY(from)} — ${formatDMY(to)}`
    if (from) return formatDMY(from)
    return 'Выберите период'
  }, [from, to])

  return (
    <div
      ref={popoverRef}
      className={[
        'relative inline-flex',
        variant === 'button' ? 'hidden md:inline-flex' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {variant === 'chip' ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={[
            'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-slate-900 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800',
            buttonClassName,
          ].join(' ')}
          aria-expanded={open}
        >
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); clear() }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); clear() } }}
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full hover:bg-white/20"
            aria-label="Сбросить период"
          >
            <X size={11} />
          </span>
          {chipLabel}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={[
            'inline-flex min-h-[38px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm transition-colors hover:bg-slate-50',
            buttonClassName,
          ].join(' ')}
          aria-expanded={open}
        >
          <CalendarDays size={15} />
          <span className="max-w-[210px] truncate">{label}</span>
          <ChevronDown size={14} />
        </button>
      )}

      {open && (
        <div
          ref={panelRef}
          style={{ left: `${panelOffset}px` }}
          className="absolute top-[calc(100%+8px)] left-0 z-50 w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900 shadow-2xl"
        >
          <div className="grid grid-cols-[220px_minmax(0,1fr)]">
            <div className="border-r border-slate-200 bg-slate-50/70 p-3">
              <PresetSection title="Диапазоны дат" presets={DATE_PRESETS} active={activePreset} onPick={applyPreset} />
            </div>

            <div className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <button type="button" onClick={() => setBaseMonth((m) => addMonths(m, -1))} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Предыдущий месяц">
                  <ChevronLeft size={17} />
                </button>
                <div className="text-xs font-bold text-slate-500">
                  {draftFrom && draftTo ? `${formatShort(draftFrom)} - ${formatShort(draftTo)}` : draftFrom ? `${formatShort(draftFrom)} - ...` : 'Выберите диапазон'}
                </div>
                <button type="button" onClick={() => setBaseMonth((m) => addMonths(m, 1))} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Следующий месяц">
                  <ChevronRight size={17} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <MonthGrid month={baseMonth} from={draftFrom} to={draftTo} onPick={pickDay} />
                <MonthGrid month={addMonths(baseMonth, 1)} from={draftFrom} to={draftTo} onPick={pickDay} />
              </div>

              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="min-w-0 text-[11px] font-semibold text-slate-400">{timezoneLabel}</div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={cancel} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">
                    <X size={13} /> Отмена
                  </button>
                  <button type="button" onClick={apply} className="inline-flex h-9 items-center rounded-lg bg-indigo-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-indigo-700">
                    {variant === 'chip' && draftFrom && draftTo
                      ? `Показать результаты — ${formatDMY(draftFrom)} - ${formatDMY(draftTo)}`
                      : 'Обновить'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PresetSection({ title, presets, active, onPick }) {
  return (
    <div>
      <p className="mb-2 px-2 text-[11px] font-bold text-slate-500">{title}</p>
      <div className="space-y-1">
        {presets.map((preset) => (
          <button
            key={`${title}-${preset.value}`}
            type="button"
            onClick={() => onPick(preset.value)}
            className={[
              'flex min-h-[34px] w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold transition-colors',
              active === preset.value ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-white',
            ].join(' ')}
          >
            <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${active === preset.value ? 'border-indigo-600' : 'border-slate-300'}`}>
              {active === preset.value && <span className="h-2 w-2 rounded-full bg-indigo-600" />}
            </span>
            <span>{preset.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function MonthGrid({ month, from, to, onPick }) {
  const days = useMemo(() => {
    const first = startOfMonth(month)
    const offset = (first.getDay() + 6) % 7
    const cells = []
    for (let i = 0; i < offset; i += 1) cells.push(null)
    const total = endOfMonth(month).getDate()
    for (let day = 1; day <= total; day += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), day))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [month])

  return (
    <div>
      <p className="mb-2 text-center text-xs font-bold capitalize text-slate-700">{formatMonth(month)}</p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1 text-[10px] font-bold text-slate-400">{day}</div>
        ))}
        {days.map((day, index) => {
          if (!day) return <div key={`empty-${index}`} className="h-8" />
          const value = toYMD(day)
          const selected = value === from || value === to
          const inRange = from && to && value > from && value < to
          const today = value === toYMD(new Date())
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPick(day)}
              className={[
                'h-8 rounded-lg text-xs font-semibold transition-colors',
                selected ? 'bg-indigo-600 text-white shadow-sm' : inRange ? 'bg-indigo-50 text-indigo-700' : today ? 'text-indigo-700 ring-1 ring-indigo-200 hover:bg-slate-100' : 'text-slate-700 hover:bg-slate-100',
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
