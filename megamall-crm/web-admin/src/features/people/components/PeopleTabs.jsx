const TABS = [
  { key: 'teams',        label: 'Команды' },
  { key: 'employees',    label: 'Сотрудники' },
  { key: 'compensation', label: 'Компенсации' },
]

export default function PeopleTabs({ active, onChange, counts = {} }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-0.5 border-b border-slate-200 scrollbar-hide mb-5">
      {TABS.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={[
            'flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] min-w-max',
            'text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-all duration-150',
            active === tab.key
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800',
          ].join(' ')}
        >
          {tab.label}
          {counts[tab.key] != null && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${
              active === tab.key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'
            }`}>
              {counts[tab.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
