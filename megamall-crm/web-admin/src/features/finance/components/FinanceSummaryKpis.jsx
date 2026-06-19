/**
 * FinanceSummaryKpis — 6 KPI tiles from FinanceSummaryResponse.
 *
 * Grid: 2-col on mobile, 3-col on sm+.
 *
 * Props:
 *   summary  {object|null}  FinanceSummaryResponse from /finance/summary
 *   loading  {bool}
 */
import { TrendingUp, Truck, BarChart2, Building2, Users2, Wallet } from 'lucide-react'
import KpiCard         from '../../../shared/components/KpiCard'
import { KpiSkeleton } from '../../../shared/components/Skeleton'
import { fmtMoney }    from '../../hr/utils/hrHelpers'

export default function FinanceSummaryKpis({ summary, loading = false }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    )
  }

  const orders  = summary?.orders  ?? {}
  const revenue = summary?.revenue ?? {}
  const cash    = summary?.cash    ?? {}

  const cards = [
    {
      label: 'Продажи',
      value: fmtMoney(orders.total_sales ?? 0),
      icon:  <TrendingUp size={20} />,
      color: 'indigo',
      trend: orders.delivered_count ? `${orders.delivered_count} заказов` : undefined,
    },
    {
      label: 'Доставка',
      value: fmtMoney(orders.delivery_fees ?? 0),
      icon:  <Truck size={20} />,
      color: 'sky',
    },
    {
      label: 'Чистая выручка',
      value: fmtMoney(orders.net_revenue ?? 0),
      icon:  <BarChart2 size={20} />,
      color: 'emerald',
    },
    {
      label: 'Доход компании',
      value: fmtMoney(revenue.company_revenue_earned ?? 0),
      icon:  <Building2 size={20} />,
      color: 'violet',
    },
    {
      label: 'Выплаты сотрудникам',
      value: fmtMoney(revenue.total_employee_payouts ?? 0),
      icon:  <Users2 size={20} />,
      color: 'amber',
    },
    {
      label: 'Касса на руках',
      value: fmtMoney(cash.cash_outstanding ?? 0),
      icon:  <Wallet size={20} />,
      color: cash.cash_outstanding > 0 ? 'rose' : 'emerald',
    },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
      {cards.map(c => (
        <KpiCard
          key={c.label}
          label={c.label}
          value={c.value}
          icon={c.icon}
          color={c.color}
          trend={c.trend}
        />
      ))}
    </div>
  )
}
