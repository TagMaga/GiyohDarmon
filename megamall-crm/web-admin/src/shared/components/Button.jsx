import { Loader2 } from 'lucide-react'

/**
 * Button — thin wrapper over the existing .btn CSS classes.
 *
 * Props:
 *   variant  {string}  — 'primary'|'secondary'|'danger'|'ghost' (default 'secondary')
 *   size     {string}  — 'sm'|'md'|'lg' (default 'md')
 *   loading  {bool}    — shows spinner, disables button
 *   icon     {ReactNode} — leading icon
 *   fullWidth{bool}
 *   ...rest  — forwarded to <button>
 */
const VARIANT_CLASS = {
  primary:   'btn-primary',
  secondary: 'btn-secondary',
  danger:    'btn-danger',
  ghost:     'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-0',
}

const SIZE_CLASS = {
  sm: 'btn-sm min-h-[36px]',
  md: 'btn-md min-h-[44px]',
  lg: 'btn-lg min-h-[48px]',
}

export default function Button({
  variant  = 'secondary',
  size     = 'md',
  loading  = false,
  icon,
  fullWidth = false,
  children,
  className = '',
  disabled,
  ...rest
}) {
  const base    = 'btn'
  const v       = VARIANT_CLASS[variant] ?? VARIANT_CLASS.secondary
  const s       = SIZE_CLASS[size]       ?? SIZE_CLASS.md
  const fw      = fullWidth ? 'w-full' : ''
  const classes = [base, v, s, fw, className].filter(Boolean).join(' ')

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      {...rest}
    >
      {loading
        ? <Loader2 size={15} className="animate-spin" />
        : icon}
      {children}
    </button>
  )
}
