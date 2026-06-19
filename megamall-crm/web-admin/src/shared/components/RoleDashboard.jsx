import { BarChart2 } from 'lucide-react'
import KpiCard from './KpiCard'
import PageHeader from './PageHeader'

export default function RoleDashboard({
  title,
  subtitle,
  headerIcon,
  kpiCards = [],
  tableTitle = 'Последние записи',
  children,
}) {
  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <PageHeader title={title} subtitle={subtitle} icon={headerIcon} />

      {/* KPI grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
        {kpiCards.map((card, i) => (
          <KpiCard
            key={i}
            label={card.label}
            value={card.value ?? '—'}
            icon={card.icon}
            color={card.color}
            trend={card.trend}
          />
        ))}
        {kpiCards.length === 0 &&
          Array.from({ length: 4 }).map((_, i) => (
            <KpiCard key={i} loading />
          ))}
      </div>

      {/* Table placeholder */}
      <div className="overflow-x-auto mb-6">
        <div className="table-placeholder">
          <div className="table-placeholder-header">
            <span className="text-sm font-semibold text-slate-800">{tableTitle}</span>
            <span
              className="text-[11px] font-medium px-2.5 py-1 rounded-full"
              style={{ background: '#EEF2FF', color: '#4338CA' }}
            >
              Скоро
            </span>
          </div>
          <div className="table-placeholder-body">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{ background: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)' }}
            >
              <BarChart2 size={24} className="text-indigo-400" />
            </div>
            <p className="text-[15px] font-semibold text-slate-700 mb-1">Данные загружаются</p>
            <p className="text-[13px] text-slate-400 max-w-xs leading-relaxed">
              Полный CRUD-функционал с фильтрами и аналитикой появится в следующем обновлении.
            </p>
          </div>
        </div>
      </div>

      {/* Extra content slot */}
      {children}
    </div>
  )
}
