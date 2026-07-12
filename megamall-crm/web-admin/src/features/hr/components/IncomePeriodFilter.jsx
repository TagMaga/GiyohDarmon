/**
 * IncomePeriodFilter — compact period selector: shared pill + popover/bottom-sheet.
 *
 * Props:
 *   from      {string}  YYYY-MM-DD
 *   to        {string}  YYYY-MM-DD
 *   onChange  {fn}      (from, to) => void
 */
import PeriodRangeFilter from '../../../shared/components/PeriodRangeFilter'

export default function IncomePeriodFilter({ from, to, onChange }) {
  return (
    <PeriodRangeFilter
      from={from ?? ''}
      to={to ?? ''}
      onChange={(range) => onChange(range.from, range.to)}
    />
  )
}
