/**
 * ManagerIncomePage — /manager/income
 *
 * Two tabs:
 *   • "Личный доход" — GET /hr/income/me (manager's own income)
 *   • "По сотрудникам" — placeholder for later (seller income drilldown)
 *
 * Uses include_events=true so the event list is shown.
 */
import { useState }   from 'react'
import Alert          from '../../../shared/components/Alert'
import IncomePeriodFilter    from '../../hr/components/IncomePeriodFilter'
import IncomeKpiCards        from '../../hr/components/IncomeKpiCards'
import IncomeByTypeBreakdown from '../../hr/components/IncomeByTypeBreakdown'
import IncomeEventsTable     from '../../hr/components/IncomeEventsTable'
import useMyIncome           from '../../hr/hooks/useMyIncome'
import { TrendingUp } from 'lucide-react'

function currentMonthDefault() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: start.toISOString().slice(0, 10),
    to:   now.toISOString().slice(0, 10),
  }
}

export default function ManagerIncomePage() {
  const def = currentMonthDefault()
  const [from, setFrom] = useState(def.from)
  const [to,   setTo]   = useState(def.to)

  const params = { from, to, include_events: true }
  const { data: report, isLoading, isError, error } = useMyIncome(params)

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-violet-600">
          <TrendingUp size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Мои доходы</h1>
          <p className="text-xs text-slate-400">Личные и командные комиссии</p>
        </div>
      </div>

      {/* Period filter */}
      <div className="card p-4">
        <IncomePeriodFilter
          from={from}
          to={to}
          onChange={(f, t) => { setFrom(f); setTo(t) }}
        />
      </div>

      {isError && (
        <Alert variant="error">
          {error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка загрузки'}
        </Alert>
      )}

      {/* KPI tiles */}
      <IncomeKpiCards report={report} loading={isLoading} />

      {/* Breakdown by type */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Разбивка по типам</h2>
        <IncomeByTypeBreakdown
          byEventType={report?.by_event_type ?? {}}
          totalIncome={report?.total_income ?? 0}
          loading={isLoading}
        />
      </div>

      {/* Events list */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">История начислений</h2>
        <IncomeEventsTable
          events={report?.events ?? []}
          loading={isLoading}
        />
      </div>
    </div>
  )
}
