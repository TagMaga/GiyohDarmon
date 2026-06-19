/**
 * IncomeByTypeBreakdown — horizontal bar breakdown of by_event_type map.
 *
 * Props:
 *   byEventType  {object}  { event_type: amount }
 *   totalIncome  {number}
 *   loading      {bool}
 */
import Badge     from '../../../shared/components/Badge'
import { fmtMoney, EVENT_TYPE_LABEL, EVENT_TYPE_BADGE } from '../utils/hrHelpers'

// Maps event type → friendly short label for income context
const INCOME_LABEL = {
  seller_commission_earned:           'Комиссия продавца',
  manager_team_commission_earned:     'Комиссия (команда)',
  manager_personal_commission_earned: 'Личная комиссия',
  team_lead_pool_earned:              'Пул руководителя',
}

function label(type) {
  return INCOME_LABEL[type] ?? EVENT_TYPE_LABEL[type] ?? type
}

export default function IncomeByTypeBreakdown({ byEventType = {}, totalIncome = 0, loading = false }) {
  const entries = Object.entries(byEventType)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse">
            <div className="flex justify-between mb-1.5">
              <div className="skeleton h-4 w-36 rounded" />
              <div className="skeleton h-4 w-20 rounded" />
            </div>
            <div className="skeleton h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm text-slate-400 text-center py-4">Нет данных за выбранный период</p>
    )
  }

  return (
    <div className="space-y-4">
      {entries.map(([type, amount]) => {
        const pct = totalIncome > 0 ? (amount / totalIncome) * 100 : 0
        const badge = EVENT_TYPE_BADGE[type] ?? 'slate'

        return (
          <div key={type}>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant={badge} size="sm">{label(type)}</Badge>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-slate-400">{pct.toFixed(1)}%</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{fmtMoney(amount)}</span>
              </div>
            </div>
            {/* Progress bar */}
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
