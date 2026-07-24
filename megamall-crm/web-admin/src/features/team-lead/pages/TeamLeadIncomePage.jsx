/**
 * TeamLeadIncomePage — /team-lead/income
 *
 * Two sections:
 *   1. "Мой доход" — own income via GET /hr/income/me
 *   2. "Доход команды" — team income via GET /hr/income/teams/:id
 *      :id = the team lead's own user_id (from auth store)
 *
 * The team section shows per-member breakdown + total.
 */
import { useState }      from 'react'
import Alert             from '../../../shared/components/Alert'
import Badge             from '../../../shared/components/Badge'
import { CardSkeleton }  from '../../../shared/components/Skeleton'
import IncomePeriodFilter    from '../../hr/components/IncomePeriodFilter'
import IncomeKpiCards        from '../../hr/components/IncomeKpiCards'
import IncomeByTypeBreakdown from '../../hr/components/IncomeByTypeBreakdown'
import IncomeEventsTable     from '../../hr/components/IncomeEventsTable'
import useMyIncome           from '../../hr/hooks/useMyIncome'
import useTeamIncome         from '../../hr/hooks/useTeamIncome'
import useAuthStore          from '../../../shared/store/authStore'
import { fmtMoney, EVENT_TYPE_LABEL, EVENT_TYPE_BADGE } from '../../hr/utils/hrHelpers'
import { Users2, Wallet } from 'lucide-react'
import { toLocalYMD } from '../../../shared/utils/date'

const TABS = [
  { key: 'personal', label: 'Мой доход' },
  { key: 'team',     label: 'Команда'   },
]

function currentMonthDefault() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: toLocalYMD(start),
    to:   toLocalYMD(now),
  }
}

// ── Team members table ────────────────────────────────────────────────────────
function TeamMembersTable({ members = [], loading }) {
  if (loading) return <div className="space-y-2">{[1,2,3].map(i=><CardSkeleton key={i}/>)}</div>
  if (!members.length) return <p className="text-sm text-slate-400 py-4 text-center">Нет данных по участникам</p>

  return (
    <div className="space-y-3">
      {members.map((m) => {
        const topTypes = Object.entries(m.by_event_type ?? {})
          .sort(([, a], [, b]) => b - a)
          .slice(0, 2)

        return (
          <div key={m.user_id} className="card p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-indigo-700">
                    {m.user_id?.slice(-3).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-mono text-slate-500 truncate">{m.user_id?.slice(0, 8)}…</p>
                  <p className="text-[10px] text-slate-400">{m.orders_count} заказов</p>
                </div>
              </div>
              <span className="text-base font-bold text-indigo-700 tabular-nums flex-shrink-0">
                {fmtMoney(m.total_income)}
              </span>
            </div>
            {topTypes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {topTypes.map(([type, amt]) => (
                  <span key={type} className="text-[10px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">
                    {EVENT_TYPE_LABEL[type] ?? type}: {fmtMoney(amt)}
                  </span>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Team income section ───────────────────────────────────────────────────────
function TeamIncomeSection({ teamLeadId, from, to }) {
  const { data: team, isLoading, isError, error } = useTeamIncome(teamLeadId, { from, to })

  if (isError) return (
    <Alert variant="error">{error?.response?.data?.error?.message ?? error?.message ?? 'Ошибка'}</Alert>
  )

  const totalIncome = team?.total_income ?? 0
  const byType      = team?.by_event_type ?? {}
  const members     = team?.members ?? []

  return (
    <div className="space-y-5">
      {/* Summary KPI */}
      <div className="card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Итого по команде</p>
            {isLoading
              ? <div className="skeleton h-8 w-32 rounded" />
              : <p className="text-3xl font-bold text-slate-900 tabular-nums">{fmtMoney(totalIncome)}</p>
            }
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
            <Users2 size={20} />
          </div>
        </div>

        <IncomeByTypeBreakdown
          byEventType={byType}
          totalIncome={totalIncome}
          loading={isLoading}
        />
      </div>

      {/* Per-member breakdown */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          Участники · {isLoading ? '…' : members.length}
        </h3>
        <TeamMembersTable members={members} loading={isLoading} />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TeamLeadIncomePage() {
  const def = currentMonthDefault()
  const [from, setFrom] = useState(def.from)
  const [to,   setTo]   = useState(def.to)
  const [tab,  setTab]  = useState('personal')

  // Auth store — need own userId for team endpoint
  const { _userId } = useAuthStore(s => ({ _userId: s.userId }))
  // userId may not be in store; we'll get it from /hr/income/me response user_id
  const personalParams = { from, to, include_events: tab === 'personal' }
  const { data: myReport, isLoading: myLoading, isError: myError, error: myErr } = useMyIncome(personalParams)

  // team lead's own user_id comes from the income report
  const myUserId = myReport?.user_id

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
          <Wallet size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-900">Доходы</h1>
          <p className="text-xs text-slate-400">Личный и командный отчёт</p>
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'px-4 py-2.5 min-h-[44px] text-sm font-semibold border-b-2 -mb-px transition-all',
              tab === t.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Personal income tab */}
      {tab === 'personal' && (
        <div className="space-y-5">
          {myError && (
            <Alert variant="error">
              {myErr?.response?.data?.error?.message ?? myErr?.message ?? 'Ошибка загрузки'}
            </Alert>
          )}

          <IncomeKpiCards report={myReport} loading={myLoading} />

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Разбивка по типам</h2>
            <IncomeByTypeBreakdown
              byEventType={myReport?.by_event_type ?? {}}
              totalIncome={myReport?.total_income ?? 0}
              loading={myLoading}
            />
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">История начислений</h2>
            <IncomeEventsTable
              events={myReport?.events ?? []}
              loading={myLoading}
            />
          </div>
        </div>
      )}

      {/* Team income tab */}
      {tab === 'team' && (
        myUserId
          ? <TeamIncomeSection teamLeadId={myUserId} from={from} to={to} />
          : myLoading
            ? <div className="space-y-2">{[1,2].map(i=><div key={i} className="skeleton h-20 rounded-2xl"/>)}</div>
            : <Alert variant="warning">Не удалось определить ID руководителя</Alert>
      )}
    </div>
  )
}
