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
 *   - Mobile (< md): a matching rounded pill chip that opens DateRangeBottomSheet
 *     (date inputs, preset pills, scrollable month calendar, apply CTA).
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
import DateRangeBottomSheet from './DateRangeBottomSheet'
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
function formatDMY(value) {
  const d = fromYMD(value)
  if (!d) return ''
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
}
function formatMonthShort(value) {
  const d = fromYMD(value)
  if (!d) return ''
  const s = d.toLocaleDateString('ru-RU', { month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
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

export default function PeriodRangeFilter({ from = '', to = '', onChange, align = 'left', className = '' }) {
  const [open, setOpen] = useState(false)

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
        onClick={() => setOpen(true)}
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

      <DateRangeBottomSheet
        open={open}
        onClose={() => setOpen(false)}
        from={from}
        to={to}
        onChange={onChange}
      />
    </>
  )
}
