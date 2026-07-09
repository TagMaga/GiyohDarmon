/**
 * IncomePeriodFilter — compact period selector: shared desktop popover + mobile calendar.
 *
 * Props:
 *   from      {string}  YYYY-MM-DD
 *   to        {string}  YYYY-MM-DD
 *   onChange  {fn}      (from, to) => void
 */
import DesktopDateRangePicker from '../../../shared/components/DesktopDateRangePicker'
import MobileDateRangeCalendar from '../../../shared/components/MobileDateRangeCalendar'

export default function IncomePeriodFilter({ from, to, onChange }) {
  return (
    <div className="space-y-2">
      <DesktopDateRangePicker
        variant="trigger"
        from={from ?? ''}
        to={to ?? ''}
        onChange={(range) => onChange(range.from, range.to)}
      />
      <MobileDateRangeCalendar
        className="w-full md:hidden"
        from={from ?? ''}
        to={to ?? ''}
        onChange={(range) => onChange(range.from, range.to)}
      />
    </div>
  )
}
