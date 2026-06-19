/**
 * StatusBadge — animated dot + label for backend health status.
 *
 * status: 'online' | 'offline' | 'checking' | 'unknown'
 * label:  optional override text
 * size:   'sm' | 'md'
 */
export default function StatusBadge({ status = 'unknown', label, size = 'sm' }) {
  const configs = {
    online:   { dot: 'bg-emerald-500',  ring: 'ring-emerald-500/30', text: 'text-emerald-700', bg: 'bg-emerald-50',  pulse: false, defaultLabel: 'Онлайн'    },
    offline:  { dot: 'bg-red-500',      ring: 'ring-red-500/30',     text: 'text-red-700',     bg: 'bg-red-50',      pulse: false, defaultLabel: 'Офлайн'    },
    checking: { dot: 'bg-amber-400',    ring: 'ring-amber-400/30',   text: 'text-amber-700',   bg: 'bg-amber-50',    pulse: true,  defaultLabel: 'Проверка…' },
    unknown:  { dot: 'bg-slate-400',    ring: 'ring-slate-400/30',   text: 'text-slate-600',   bg: 'bg-slate-100',   pulse: false, defaultLabel: 'Неизвестно'},
  }

  const cfg = configs[status] ?? configs.unknown
  const displayLabel = label ?? cfg.defaultLabel

  if (size === 'sm') {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg} ${cfg.text}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse-slow' : ''}`} />
        {displayLabel}
      </span>
    )
  }

  // md — larger pill with ring
  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${cfg.bg} ${cfg.text} ring-1 ${cfg.ring}`}>
      <span className={`w-2 h-2 rounded-full ${cfg.dot} ${cfg.pulse ? 'animate-pulse-slow' : ''}`} />
      {displayLabel}
    </span>
  )
}
