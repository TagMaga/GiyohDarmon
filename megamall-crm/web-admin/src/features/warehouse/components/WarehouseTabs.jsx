const TABS = [
  { key: 'inventory',   label: 'Остатки' },
  { key: 'products',    label: 'Товары' },
  { key: 'movements',   label: 'Движения' },
  { key: 'adjustments', label: 'Приход' },
  { key: 'writeoffs',   label: 'Списания' },
  { key: 'transfers',   label: 'Перемещения' },
]

export default function WarehouseTabs({ active, onChange }) {
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
