/**
 * ManagerIncomePage — /manager/income
 *
 * Two tabs:
 *   • "Заработок" — GET /hr/income/me (manager's own income), unchanged
 *   • "Выплаты" — payout history, mirrors SellerIncomePage's payoutsContent
 *     exactly (same PAYOUT_STATUS map, same card layout), just sourced from
 *     the shared useMyPayouts() hook so the manager sees payments made to
 *     them by their team lead — same component, no re-implementation.
 *
 * Uses include_events=true so the event list is shown.
 */
import { useState }   from 'react'
import { CalendarCheck, TrendingUp } from 'lucide-react'
import Alert          from '../../../shared/components/Alert'
import IncomePeriodFilter    from '../../hr/components/IncomePeriodFilter'
import IncomeKpiCards        from '../../hr/components/IncomeKpiCards'
import IncomeByTypeBreakdown from '../../hr/components/IncomeByTypeBreakdown'
import IncomeEventsTable     from '../../hr/components/IncomeEventsTable'
import useMyIncome           from '../../hr/hooks/useMyIncome'
import useMyPayouts          from '../../../shared/hooks/useMyPayouts'
import { fmtAmount, fmtDate } from '../../../shared/orderStatusConfig'

function currentMonthDefault() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: start.toISOString().slice(0, 10),
    to:   now.toISOString().slice(0, 10),
  }
}

const PAYOUT_STATUS = {
  paid:    { label: 'Выплачено', cls: 'text-emerald-700 bg-emerald-50' },
  pending: { label: 'Ожидает',  cls: 'text-amber-700 bg-amber-50' },
  voided:  { label: 'Отменено', cls: 'text-slate-500 bg-slate-100' },
}

export default function ManagerIncomePage() {
  const def = currentMonthDefault()
  const [from, setFrom] = useState(def.from)
  const [to,   setTo]   = useState(def.to)
  const [tab, setTab]   = useState('income')

  const params = { from, to, include_events: true }
  const { data: report, isLoading, isError, error } = useMyIncome(params)
  const { data: payouts = [], isLoading: payoutsLoading } = useMyPayouts()

  const tabBar = (
    <div
      className="flex gap-1 rounded-2xl p-1"
      style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(226,232,240,0.6)' }}
    >
      {[
        { id: 'income',  label: 'Заработок' },
        { id: 'payouts', label: 'Выплаты' },
      ].map(t => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
          style={tab === t.id
            ? { background: 'white', color: '#4F46E5', boxShadow: '0 2px 8px rgba(16,24,40,0.08)' }
            : { color: '#94A3B8' }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )

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

      {tabBar}

      {tab === 'income' && (
        <div className="space-y-6">
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
      )}

      {tab === 'payouts' && (
        <div className="card overflow-hidden">
          {payoutsLoading ? (
            <div className="p-6 text-center text-sm text-slate-400">Загрузка…</div>
          ) : payouts.length === 0 ? (
            <div className="p-10 text-center">
              <CalendarCheck size={32} className="mx-auto mb-3 text-slate-200" />
              <p className="text-sm font-semibold text-slate-500">Выплат пока нет</p>
              <p className="text-xs text-slate-300 mt-1">Появятся здесь после первой выплаты от вашего тимлида</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {payouts.map(p => {
                const st = PAYOUT_STATUS[p.status] ?? { label: p.status, cls: 'text-slate-600 bg-slate-100' }
                return (
                  <div key={p.id} className="flex items-center justify-between px-5 py-4 gap-4">
                    <div>
                      <p className="text-base font-black text-slate-900">{fmtAmount(p.amount)} сомони</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {p.period_start} — {p.period_end}
                        {p.method && <span className="ml-2 text-slate-300">· {p.method}</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${st.cls}`}>{st.label}</span>
                      {p.paid_at && <span className="text-[10px] text-slate-400">{fmtDate(p.paid_at)}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
