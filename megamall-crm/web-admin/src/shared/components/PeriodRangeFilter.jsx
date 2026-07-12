/**
 * PeriodRangeFilter — compact date-range period selector, consistent across
 * mobile and desktop. This is the same "small pill (e.g. «Июль ⌄») that opens a
 * compact popover/sheet" pattern used by the Журнал начислений filter bar
 * (FinanceFilterBar's period control) — extracted here so the owner Главная /
 * Заказы / Финансы / Бюджет pages can share it instead of dropping the giant
 * inline MobileDateRangeCalendar on mobile.
 *
 *   - Desktop (>= md): reuses DesktopDateRangePicker(variant="trigger"), the
 *     bordered "Июль ⌄" pill that opens a popover with presets + month grid.
 *   - Mobile (< md): a matching rounded pill chip that opens a BottomSheet with
 *     date inputs, preset pills and a scrollable month calendar.
 *
 * Props:
 *   from      {string}  YYYY-MM-DD ('' = no bound / Максимум)
 *   to        {string}  YYYY-MM-DD
 *   onChange  {fn}      ({ from, to }) => void
 *   align     {'left'|'right'}  desktop popover alignment (default 'left')
 *   className {string}  extra classes on the wrapper
 */
import { useMemo, useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import BottomSheet from './BottomSheet'
import DesktopDateRangePicker from './DesktopDateRangePicker'

function toYMD(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}
function fromYMD(value) {
  if (!value) return null
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
function addDays(date, days) { const n = new Date(date); n.setDate(n.getDate() + days); return n }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1) }
function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0) }
function addMonths(date, months) { return new Date(date.getFullYear(), date.getMonth() + months, 1) }
function formatDMY(value) {
  const d = fromYMD(value)
  if (!d) return ''
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
function formatHuman(value) {
  const d = fromYMD(value)
  if (!d) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
function formatMonthShort(value) {
  const d = fromYMD(value)
  if (!d) return ''
  const s = d.toLocaleDateString('ru-RU', { month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function formatMonthLabel(date) { return date.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) }
function parseDMY(text) {
  const m = text.trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (!m) return null
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Presets mirror DesktopDateRangePicker's popover so the mobile sheet and the
// desktop popover offer the same choices.
const DATE_PRESETS = [
  { label: 'Сегодня', get: () => { const t = toYMD(new Date()); return { from: t, to: t } } },
  { label: 'Вчера', get: () => { const y = toYMD(addDays(new Date(), -1)); return { from: y, to: y } } },
  { label: 'Последние 7 дн.', get: () => ({ from: toYMD(addDays(new Date(), -6)), to: toYMD(new Date()) }) },
  { label: 'Последние 30 дн.', get: () => ({ from: toYMD(addDays(new Date(), -29)), to: toYMD(new Date()) }) },
  { label: 'Этот месяц', get: () => ({ from: toYMD(startOfMonth(new Date())), to: toYMD(new Date()) }) },
  { label: 'Максимум', get: () => ({ from: '', to: '' }) },
]
const WEEKDAYS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']

export default function PeriodRangeFilter({ from = '', to = '', onChange, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({})
  const [monthCount, setMonthCount] = useState(2)

  function patchDraft(patch) { setDraft((d) => ({ ...d, ...patch })) }

  function openSheet() {
    setDraft({ from, to, fromTxt: formatDMY(from), toTxt: formatDMY(to) })
    setMonthCount(2)
    setOpen(true)
  }
  function closeSheet() { setOpen(false); setDraft({}) }

  function pickDay(day) {
    const value = toYMD(day)
    let nextFrom = draft.from, nextTo = draft.to
    if (!nextFrom || (nextFrom && nextTo)) { nextFrom = value; nextTo = '' }
    else if (value < nextFrom) { nextTo = nextFrom; nextFrom = value }
    else { nextTo = value }
    patchDraft({ from: nextFrom, to: nextTo, fromTxt: formatDMY(nextFrom), toTxt: formatDMY(nextTo) })
  }
  function onFromText(e) {
    const text = e.target.value
    const value = parseDMY(text)
    patchDraft(value ? { fromTxt: text, from: value } : { fromTxt: text })
  }
  function onToText(e) {
    const text = e.target.value
    const value = parseDMY(text)
    patchDraft(value ? { toTxt: text, to: value } : { toTxt: text })
  }

  function applySheet() {
    onChange({ from: draft.from || '', to: draft.from ? (draft.to || draft.from) : '' })
    closeSheet()
  }

  const baseMonth = useMemo(
    () => startOfMonth(fromYMD(from) ?? fromYMD(to) ?? addMonths(new Date(), -1)),
    [from, to],
  )
  const months = useMemo(
    () => Array.from({ length: monthCount }, (_, i) => addMonths(baseMonth, i)),
    [baseMonth, monthCount],
  )

  // Pill label: month name when the range is exactly the current month, else
  // the matched preset label / raw range, else "Максимум" (no bounds).
  const label = useMemo(() => {
    if (!from) return 'Максимум'
    const thisMonth = DATE_PRESETS.find((p) => p.label === 'Этот месяц').get()
    if (from === thisMonth.from && (to || from) === thisMonth.to) return formatMonthShort(from)
    const matched = DATE_PRESETS.find((p) => {
      const r = p.get()
      return r.from === from && r.to === (to || from)
    })
    if (matched) return matched.label
    return `${formatDMY(from)} — ${formatDMY(to || from)}`
  }, [from, to])

  const ctaLabel = draft.from
    ? `Показать результаты — ${formatHuman(draft.from)}${draft.to && draft.to !== draft.from ? ` – ${formatHuman(draft.to)}` : ''}`
    : 'Максимум'

  return (
    <>
      {/* Desktop (>= md): reuse the shared trigger pill + popover. */}
      <DesktopDateRangePicker
        variant="trigger"
        from={from}
        to={to}
        onChange={(range) => onChange({ from: range.from, to: range.to })}
        align={align}
        className={className}
      />

      {/* Mobile (< md): matching pill chip that opens a compact sheet. */}
      <button
        type="button"
        onClick={openSheet}
        aria-expanded={open}
        className={[
          'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 md:hidden',
          className,
        ].filter(Boolean).join(' ')}
      >
        <CalendarDays size={14} className="opacity-60" />
        <span className="max-w-[180px] truncate">{label}</span>
        <ChevronDown size={13} className={`opacity-50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      <BottomSheet
        open={open}
        onClose={closeSheet}
        title="Выбор периода"
        footer={(
          <button
            type="button"
            onClick={applySheet}
            className="flex h-[50px] w-full items-center justify-center rounded-full bg-indigo-600 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(79,70,229,.28)] transition-colors hover:bg-indigo-700"
          >
            {ctaLabel}
          </button>
        )}
      >
        <div className="mb-1 mt-1.5 flex items-center gap-2.5">
          <input
            type="text" inputMode="numeric" placeholder="дд.мм.гггг"
            value={draft.fromTxt ?? ''} onChange={onFromText} aria-label="Дата от"
            className="h-[42px] min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-sm font-semibold text-slate-900 outline-none focus:border-indigo-300 focus:bg-white"
          />
          <span className="flex-shrink-0 font-semibold text-slate-400">—</span>
          <input
            type="text" inputMode="numeric" placeholder="дд.мм.гггг"
            value={draft.toTxt ?? ''} onChange={onToText} aria-label="Дата до"
            className="h-[42px] min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-center text-sm font-semibold text-slate-900 outline-none focus:border-indigo-300 focus:bg-white"
          />
        </div>

        <div className="mb-1 mt-3 flex flex-wrap gap-2">
          {DATE_PRESETS.map((preset) => {
            const range = preset.get()
            const active = (draft.from || '') === range.from && (draft.to || '') === range.to
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => patchDraft({ ...range, fromTxt: formatDMY(range.from), toTxt: formatDMY(range.to) })}
                className={[
                  'h-8 rounded-full px-3 text-xs font-semibold transition-colors',
                  active ? 'border border-indigo-600 bg-indigo-50 text-indigo-700' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                ].join(' ')}
              >
                {preset.label}
              </button>
            )
          })}
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((d) => <span key={d} className="text-[11px] font-bold text-slate-400">{d}</span>)}
        </div>
        {months.map((month, i) => (
          <MonthGrid key={i} month={month} from={draft.from} to={draft.to} onPick={pickDay} />
        ))}
        <button
          type="button"
          onClick={() => setMonthCount((c) => c + 1)}
          className="mt-1 w-full rounded-lg py-2 text-center text-[12px] font-bold text-indigo-600 hover:bg-indigo-50"
        >
          Показать следующий месяц
        </button>
      </BottomSheet>
    </>
  )
}

function MonthGrid({ month, from, to, onPick }) {
  const days = useMemo(() => {
    const first = startOfMonth(month)
    const offset = (first.getDay() + 6) % 7
    const cells = []
    for (let i = 0; i < offset; i += 1) cells.push(null)
    const total = endOfMonth(month).getDate()
    for (let d = 1; d <= total; d += 1) cells.push(new Date(month.getFullYear(), month.getMonth(), d))
    return cells
  }, [month])

  return (
    <div className="pb-1 pt-3">
      <p className="mb-2 text-[15px] font-bold capitalize text-slate-900">{formatMonthLabel(month)}</p>
      <div className="grid grid-cols-7 gap-1">
        {days.map((day, i) => {
          if (!day) return <div key={`e-${i}`} className="h-[42px]" />
          const value = toYMD(day)
          const edge = value === from || value === to
          const inRange = Boolean(from && to && value > from && value < to)
          return (
            <button
              key={value}
              type="button"
              onClick={() => onPick(day)}
              className={[
                'h-[42px] select-none rounded-full text-[13.5px] font-semibold transition-colors',
                edge ? 'bg-indigo-600 text-white' : inRange ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-100',
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
