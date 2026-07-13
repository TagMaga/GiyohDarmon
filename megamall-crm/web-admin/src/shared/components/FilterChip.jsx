import { ChevronDown, X } from 'lucide-react'

/**
 * FilterChip — pill trigger for a filter, shared by every "open a sheet
 * to filter by X" control (event type, amount, user, order, date range).
 *
 * Inactive: outlined, chevron-down. Active: filled dark, tap-to-clear X.
 *
 * Props:
 *   label         {string}    — chip text; ignored if `children` is passed
 *   children      {ReactNode} — overrides `label` when present (e.g. icon + text)
 *   icon          {ReactNode} — optional leading icon, shown before the text
 *   active        {bool}
 *   onClick       {fn}      — opens the sheet/popover
 *   onClear       {fn}      — clears just this filter (only called when active)
 *   ariaExpanded  {bool}    — optional, for chips that toggle a popover
 *   className     {string}  — optional extra classes
 *   maxWidthClass {string}  — optional override; pass '' for chips whose
 *                             label can run long (e.g. a date range)
 */
export default function FilterChip({
  label,
  children,
  icon,
  active,
  onClick,
  onClear,
  ariaExpanded,
  className = '',
  maxWidthClass = 'max-w-[180px]',
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={ariaExpanded}
      className={[
        'inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition-colors',
        maxWidthClass,
        active ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
        className,
      ].filter(Boolean).join(' ')}
    >
      {active && onClear && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onClear() }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onClear() } }}
          className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full hover:bg-white/20"
          aria-label="Сбросить"
        >
          <X size={11} />
        </span>
      )}
      {icon && <span className="flex-shrink-0 opacity-80">{icon}</span>}
      <span className="truncate">{children ?? label}</span>
      {!active && <ChevronDown size={13} className="opacity-55" />}
    </button>
  )
}
