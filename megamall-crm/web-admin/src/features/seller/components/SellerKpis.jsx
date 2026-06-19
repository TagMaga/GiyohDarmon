/**
 * SellerKpis — 4 KPI cards for the seller home screen.
 *
 * • Заказов сегодня  — derived from the orders list (fast, already fetched)
 * • Новые            — derived from orders list
 * • Доставлено       — derived from orders list
 * • Мой доход        — from GET /hr/income/me (current-month window)
 *
 * Income is fetched separately via useMyIncome so it is always accurate
 * and not affected by the orders list page/filter state.
 */
import { useMemo }    from 'react'
import { ShoppingCart, CheckCircle2, Clock, TrendingUp } from 'lucide-react'
import KpiCard        from '../../../shared/components/KpiCard'
import { KpiSkeleton } from '../../../shared/components/Skeleton'
import { fmtMoney }   from '../../hr/utils/hrHelpers'
import useMyIncome    from '../../hr/hooks/useMyIncome'

function currentMonthParams() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: start.toISOString().slice(0, 10),
    to:   now.toISOString().slice(0, 10),
  }
}

/**
 * Props:
 *   orders  {Array}   seller orders already loaded by the parent page
 *   loading {bool}    true while orders are loading
 */
export default function SellerKpis({ orders = [], loading = false }) {
  const incomeParams = useMemo(() => currentMonthParams(), [])
  const { data: incomeReport, isLoading: incomeLoading } = useMyIncome(incomeParams)

  const stats = useMemo(() => {
    const today = new Date().toDateString()
    let todayCount = 0
    let newCount = 0
    let deliveredCount = 0

    for (const o of orders) {
      if (new Date(o.created_at).toDateString() === today) todayCount++
      if (o.status === 'new') newCount++
      if (o.status === 'delivered') deliveredCount++
    }
    return { todayCount, newCount, deliveredCount }
  }, [orders])

  const income = incomeReport?.total_income ?? 0
  const isLoading = loading || incomeLoading

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    )
  }

  const cards = [
    { label: 'Заказов сегодня', value: String(stats.todayCount),     icon: <Clock        size={20} />, color: 'indigo'  },
    { label: 'Новые',           value: String(stats.newCount),       icon: <ShoppingCart size={20} />, color: 'sky'     },
    { label: 'Доставлено',      value: String(stats.deliveredCount), icon: <CheckCircle2 size={20} />, color: 'emerald' },
    { label: 'Доход (месяц)',   value: fmtMoney(income),             icon: <TrendingUp   size={20} />, color: 'amber'   },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
      {cards.map((c) => (
        <KpiCard key={c.label} label={c.label} value={c.value} icon={c.icon} color={c.color} />
      ))}
    </div>
  )
}
