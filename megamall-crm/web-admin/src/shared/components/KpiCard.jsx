const colorMap = {
  indigo: {
    bg:      'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
    iconBg:  'bg-indigo-100',
    icon:    'text-indigo-600',
    value:   'text-indigo-900',
    badge:   'bg-white/70 text-indigo-700',
  },
  emerald: {
    bg:      'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
    iconBg:  'bg-emerald-100',
    icon:    'text-emerald-600',
    value:   'text-emerald-900',
    badge:   'bg-white/70 text-emerald-700',
  },
  amber: {
    bg:      'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
    iconBg:  'bg-amber-100',
    icon:    'text-amber-600',
    value:   'text-amber-900',
    badge:   'bg-white/70 text-amber-700',
  },
  violet: {
    bg:      'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)',
    iconBg:  'bg-violet-100',
    icon:    'text-violet-600',
    value:   'text-violet-900',
    badge:   'bg-white/70 text-violet-700',
  },
  rose: {
    bg:      'linear-gradient(135deg, #FFF1F2 0%, #FFE4E6 100%)',
    iconBg:  'bg-rose-100',
    icon:    'text-rose-600',
    value:   'text-rose-900',
    badge:   'bg-white/70 text-rose-700',
  },
  sky: {
    bg:      'linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%)',
    iconBg:  'bg-sky-100',
    icon:    'text-sky-600',
    value:   'text-sky-900',
    badge:   'bg-white/70 text-sky-700',
  },
}

export default function KpiCard({ label, value = '—', icon, color = 'indigo', trend, loading = false }) {
  const c = colorMap[color] ?? colorMap.indigo

  if (loading) {
    return (
      <div className="kpi-card" style={{ background: 'linear-gradient(135deg, #F8FAFC 0%, #F1F5F9 100%)' }}>
        <div className="flex items-start justify-between mb-5">
          <div className="skeleton w-11 h-11 rounded-2xl" />
          <div className="skeleton w-16 h-5 rounded-full" />
        </div>
        <div className="skeleton w-20 h-10 rounded-xl mb-2" />
        <div className="skeleton w-28 h-4 rounded-full" />
      </div>
    )
  }

  return (
    <div className="kpi-card group overflow-hidden relative" style={{ background: c.bg }}>
      {/* Top row: icon + trend badge */}
      <div className="flex items-start justify-between mb-5">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${c.iconBg} ${c.icon}
                         transition-transform duration-200 group-hover:scale-105`}>
          {icon}
        </div>
        {trend && (
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${c.badge}`}>
            {trend}
          </span>
        )}
      </div>

      {/* Hero value */}
      <p className={`text-[32px] font-bold leading-tight tracking-tight mb-1.5 ${c.value}`}>
        {value}
      </p>

      {/* Label */}
      <p className="text-[13px] font-medium text-slate-500 leading-snug">{label}</p>
    </div>
  )
}
