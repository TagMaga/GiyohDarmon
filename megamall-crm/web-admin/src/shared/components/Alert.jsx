import { AlertTriangle, XCircle, Info, CheckCircle2 } from 'lucide-react'

/**
 * Alert — inline banner for errors / warnings / info.
 *
 * Props:
 *   variant  {string}  — 'error'|'warning'|'info'|'success' (default 'error')
 *   title    {string}  — optional bold heading
 *   children {ReactNode} — message body
 */
const CONFIGS = {
  error: {
    bg:   'bg-red-50 border-red-200',
    icon: <XCircle      size={16} className="text-red-500 flex-shrink-0 mt-0.5" />,
    text: 'text-red-800',
    sub:  'text-red-700',
  },
  warning: {
    bg:   'bg-amber-50 border-amber-200',
    icon: <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />,
    text: 'text-amber-800',
    sub:  'text-amber-700',
  },
  info: {
    bg:   'bg-blue-50 border-blue-200',
    icon: <Info         size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />,
    text: 'text-blue-800',
    sub:  'text-blue-700',
  },
  success: {
    bg:   'bg-emerald-50 border-emerald-200',
    icon: <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0 mt-0.5" />,
    text: 'text-emerald-800',
    sub:  'text-emerald-700',
  },
}

export default function Alert({ variant = 'error', title, children }) {
  const cfg = CONFIGS[variant] ?? CONFIGS.error
  return (
    <div className={`flex items-start gap-3 p-4 rounded-2xl border ${cfg.bg}`} role="alert">
      {cfg.icon}
      <div>
        {title && <p className={`text-sm font-semibold ${cfg.text}`}>{title}</p>}
        {children && (
          <p className={`text-xs leading-relaxed ${title ? 'mt-0.5' : ''} ${cfg.sub}`}>
            {children}
          </p>
        )}
      </div>
    </div>
  )
}
