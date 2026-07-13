/**
 * IncomePeriodFilter — compact period selector: shared desktop popover + mobile calendar.
 *
 * Props:
 *   from      {string}  YYYY-MM-DD
 *   to        {string}  YYYY-MM-DD
 *   onChange  {fn}      (from, to) => void
 */
import { useState } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import DesktopDateRangePicker from '../../../shared/components/DesktopDateRangePicker'
import MobileDateRangeCalendar from '../../../shared/components/MobileDateRangeCalendar'

function short(value) {
  if (!value) return ''
  const [, month, day] = value.split('-')
  return `${day}.${month}`
}

export default function IncomePeriodFilter({ from, to, onChange }) {
  const [open, setOpen] = useState(false)
  const label = from && to ? `${short(from)}–${short(to)}` : 'Период'

  return (
    <div className="space-y-2">
      <DesktopDateRangePicker
        variant="trigger"
        from={from ?? ''}
        to={to ?? ''}
        onChange={(range) => onChange(range.from, range.to)}
      />

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 md:hidden"
      >
        <CalendarDays size={14} className="opacity-60" />
        <span>{label}</span>
        <ChevronDown size={13} className={`opacity-50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <MobileDateRangeCalendar
          className="w-full md:hidden"
          from={from ?? ''}
          to={to ?? ''}
          onChange={(range) => {
            onChange(range.from, range.to)
            if (range.from && range.to) setOpen(false)
          }}
        />
      )}
    </div>
  )
}
