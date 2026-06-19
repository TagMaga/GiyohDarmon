const TABS = [
  { key: 'tariff',    label: 'Тариф' },
  { key: 'configs',   label: 'Конфиги' },
  { key: 'history',   label: 'История' },
  { key: 'preview',   label: 'Калькулятор' },
  { key: 'events',    label: 'События' },
]

export default function HrTabs({ active, onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-0.5 border-b border-slate-200 scrollbar-hide mb-5">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={[
            'flex items-center px-3 py-2.5 min-h-[44px] min-w-max',
            'text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-all duration-150',
            active === tab.key
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800',
          ].join(' ')}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
