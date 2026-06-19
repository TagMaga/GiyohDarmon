import { useQuery }   from '@tanstack/react-query'
import { KEYS }       from '../../../shared/queryKeys'
import { fetchEmployeeOrders } from '../api'
import { calcPerformance, fmtMoney, isCourier } from '../utils/peopleHelpers'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import Alert           from '../../../shared/components/Alert'
import { ShoppingCart, CheckCircle2, TrendingUp, Hash } from 'lucide-react'

/**
 * EmployeePerformance — order stats for one employee.
 *
 * Props:
 *   user {object}
 */
export default function EmployeePerformance({ user }) {
  const userId = user?.id
  const role   = user?.role ?? user?.Role ?? ''

  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: KEYS.people.employeeOrders(userId, {}),
    queryFn:  () => fetchEmployeeOrders(userId, role),
    staleTime: 2 * 60_000,
    enabled:  !!userId && !isCourier(user),
  })

  if (isCourier(user)) {
    return (
      <Alert variant="info">
        Статистика заказов курьера доступна через панель диспетчера.
        Здесь отображаются только данные продавцов, менеджеров и руководителей.
      </Alert>
    )
  }

  if (isLoading) return <div className="space-y-2">{[1,2].map(i => <CardSkeleton key={i} />)}</div>
  if (isError)   return <Alert variant="error">Не удалось загрузить данные по заказам</Alert>

  const { total, delivered, revenue, avgOrder } = calcPerformance(orders)

  const stats = [
    { label: 'Всего заказов',   value: String(total),           icon: <ShoppingCart size={16} />, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Доставлено',      value: String(delivered),        icon: <CheckCircle2 size={16} />, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Выручка',         value: fmtMoney(revenue),        icon: <TrendingUp   size={16} />, color: 'text-sky-600', bg: 'bg-sky-50' },
    { label: 'Средний чек',     value: fmtMoney(avgOrder),       icon: <Hash         size={16} />, color: 'text-violet-600', bg: 'bg-violet-50' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map(s => (
        <div key={s.label} className="card p-4">
          <div className={`w-8 h-8 rounded-xl ${s.bg} flex items-center justify-center mb-2 ${s.color}`}>
            {s.icon}
          </div>
          <p className="text-lg font-bold text-slate-900 leading-none">{s.value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
        </div>
      ))}
    </div>
  )
}
