/**
 * IncomeKpiCards — 4 KPI tiles from an IncomeReportResponse.
 *
 * Props:
 *   report   {object|null}  IncomeReportResponse from backend
 *   loading  {bool}
 */
import { TrendingUp, ShoppingBag, CheckCircle2, BarChart2 } from 'lucide-react'
import KpiCard          from '../../../shared/components/KpiCard'
import { KpiSkeleton }  from '../../../shared/components/Skeleton'
import { fmtMoney }     from '../utils/hrHelpers'

export default function IncomeKpiCards({ report, loading = false }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    )
  }

  const totalIncome    = report?.total_income     ?? 0
  const ordersCount    = report?.orders_count     ?? 0
  const deliveredCount = report?.delivered_count  ?? 0
  const avgPerOrder    = report?.average_per_order ?? 0

  const cards = [
    {
      label: 'Доход за период',
      value: fmtMoney(totalIncome),
      icon:  <TrendingUp size={20} />,
      color: 'indigo',
    },
    {
      label: 'Всего заказов',
      value: String(ordersCount),
      icon:  <ShoppingBag size={20} />,
      color: 'sky',
    },
    {
      label: 'Доставлено',
      value: String(deliveredCount),
      icon:  <CheckCircle2 size={20} />,
      color: 'emerald',
    },
    {
      label: 'Средний чек',
      value: fmtMoney(avgPerOrder),
      icon:  <BarChart2 size={20} />,
      color: 'violet',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {cards.map(c => (
        <KpiCard
          key={c.label}
          label={c.label}
          value={c.value}
          icon={c.icon}
          color={c.color}
        />
      ))}
    </div>
  )
}
