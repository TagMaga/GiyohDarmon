/**
 * Badge — coloured pill label.
 *
 * Props:
 *   variant  {string}  — 'indigo'|'emerald'|'amber'|'rose'|'sky'|'slate'|'violet'|'orange'
 *   size     {string}  — 'sm'|'md' (default 'sm')
 *   dot      {bool}    — show animated dot prefix
 *   children {ReactNode}
 */
const VARIANTS = {
  indigo:  'bg-indigo-50  text-indigo-700  border-indigo-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber:   'bg-amber-50   text-amber-700   border-amber-200',
  rose:    'bg-rose-50    text-rose-700    border-rose-200',
  sky:     'bg-sky-50     text-sky-700     border-sky-200',
  slate:   'bg-slate-100  text-slate-600   border-slate-200',
  violet:  'bg-violet-50  text-violet-700  border-violet-200',
  orange:  'bg-orange-50  text-orange-700  border-orange-200',
  red:     'bg-red-50     text-red-700     border-red-200',
}

const DOT_COLORS = {
  indigo:  'bg-indigo-500',
  emerald: 'bg-emerald-500',
  amber:   'bg-amber-400',
  rose:    'bg-rose-500',
  sky:     'bg-sky-500',
  slate:   'bg-slate-400',
  violet:  'bg-violet-500',
  orange:  'bg-orange-500',
  red:     'bg-red-500',
}

export default function Badge({ variant = 'slate', size = 'sm', dot = false, children }) {
  const v = VARIANTS[variant] ?? VARIANTS.slate
  const d = DOT_COLORS[variant] ?? DOT_COLORS.slate
  const sz = size === 'md'
    ? 'text-xs px-2.5 py-1'
    : 'text-[11px] px-2 py-0.5'

  return (
    <span className={`inline-flex items-center gap-1.5 font-medium rounded-full border ${v} ${sz}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d}`} />}
      {children}
    </span>
  )
}
