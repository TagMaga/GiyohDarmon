import { useQuery }    from '@tanstack/react-query'
import { KEYS }        from '../../../shared/queryKeys'
import { fetchTeamOrders } from '../api'
import { calcPerformance, fmtMoney } from '../utils/peopleHelpers'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import Alert            from '../../../shared/components/Alert'
import { ShoppingCart, CheckCircle2, TrendingUp, Hash } from 'lucide-react'

/**
 * TeamPerformance — order stats for a team (uses team_lead_id filter).
 *
 * Props:
 *   team {object}  — team row (needs team_lead_id to query)
 */
export default function TeamPerformance({ team }) {
  const teamLeadId = team?.team_lead_id

  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: KEYS.people.teamOrders(team?.id, {}),
    queryFn:  () => fetchTeamOrders(teamLeadId),
    staleTime: 2 * 60_000,
    enabled:  !!teamLeadId,
  })

  if (!teamLeadId) {
    return <Alert variant="warning">Для просмотра статистики назначьте руководителя команды.</Alert>
  }

  if (isLoading) return <div className="space-y-2">{[1,2].map(i => <CardSkeleton key={i} />)}</div>
  if (isError)   return <Alert variant="error">Не удалось загрузить заказы команды</Alert>

  const { total, delivered, revenue, avgOrder } = calcPerformance(orders)

  const stats = [
    { label: 'Всего заказов',   value: String(total),     color: 'text-indigo-600', bg: 'bg-indigo-50',   icon: <ShoppingCart size={16} /> },
    { label: 'Доставлено',      value: String(delivered),  color: 'text-emerald-600', bg: 'bg-emerald-50', icon: <CheckCircle2 size={16} /> },
    { label: 'Выручка',         value: fmtMoney(revenue),  color: 'text-sky-600',    bg: 'bg-sky-50',      icon: <TrendingUp   size={16} /> },
    { label: 'Средний чек',     value: fmtMoney(avgOrder), color: 'text-violet-600', bg: 'bg-violet-50',   icon: <Hash         size={16} /> },
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
