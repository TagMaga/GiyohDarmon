/**
 * OwnerFinancePage — /owner/finance
 *
 * Full owner finance dashboard. Layout:
 *   1. Header (icon + title + subtitle + refresh)
 *   2. Period filter
 *   3. 6 KPI tiles (from /finance/summary)
 *   4. Two-col on md+: RevenueBreakdownCard | CommissionsBreakdown
 *   5. CashFlowPanel (full width)
 *   6. FinanceEventsTable (paginated ledger)
 *
 * All monetary figures come from the backend — zero client-side aggregation.
 */
import { useState }              from 'react'
import { RefreshCw, TrendingUp } from 'lucide-react'
import Alert                     from '../../../shared/components/Alert'
import IncomePeriodFilter        from '../../hr/components/IncomePeriodFilter'
import FinanceSummaryKpis        from '../components/FinanceSummaryKpis'
import RevenueBreakdownCard      from '../components/RevenueBreakdownCard'
import CommissionsBreakdown      from '../components/CommissionsBreakdown'
import CashFlowPanel             from '../components/CashFlowPanel'
import FinanceEventsTable        from '../components/FinanceEventsTable'
import useFinanceSummary         from '../hooks/useFinanceSummary'

// ── Date helpers ───────────────────────────────────────────────────────────────

function toYMD(date) {
  return date.toISOString().slice(0, 10)
}

function currentMonthDefault() {
  const now   = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return { from: toYMD(start), to: toYMD(now) }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OwnerFinancePage() {
  const def = currentMonthDefault()
  const [from, setFrom] = useState(def.from)
  const [to,   setTo]   = useState(def.to)

  const summaryParams = { from, to }
  const {
    data:      summary,
    isLoading: summaryLoading,
    isError:   summaryError,
    error:     summaryErr,
    refetch,
    isFetching,
  } = useFinanceSummary(summaryParams)

  function handlePeriodChange(f, t) {
    setFrom(f)
    setTo(t)
  }

  return (
    <div className="p-4 md:p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 flex-shrink-0">
            <TrendingUp size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Финансы</h1>
            <p className="text-xs text-slate-400">Финансовая сводка бизнеса</p>
          </div>
        </div>

        {/* Refresh button */}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[44px] flex-shrink-0"
          title="Обновить данные"
        >
          <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Обновить</span>
        </button>
      </div>

      {/* ── Period filter ───────────────────────────────────────────────────── */}
      <div className="card p-4">
        <IncomePeriodFilter
          from={from}
          to={to}
          onChange={handlePeriodChange}
        />
      </div>

      {/* ── Error alert ─────────────────────────────────────────────────────── */}
      {summaryError && (
        <Alert variant="error">
          {summaryErr?.response?.data?.error?.message ?? summaryErr?.message ?? 'Ошибка загрузки данных'}
        </Alert>
      )}

      {/* ── 6 KPI tiles ─────────────────────────────────────────────────────── */}
      <FinanceSummaryKpis
        summary={summary}
        loading={summaryLoading}
      />

      {/* ── Revenue breakdown + Commissions (side by side on md+) ───────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RevenueBreakdownCard
          revenue={summary?.revenue}
          orders={summary?.orders}
          loading={summaryLoading}
        />
        <CommissionsBreakdown
          revenue={summary?.revenue}
          loading={summaryLoading}
        />
      </div>

      {/* ── Cash flow panel ─────────────────────────────────────────────────── */}
      <CashFlowPanel
        cash={summary?.cash}
        loading={summaryLoading}
      />

      {/* ── Financial events ledger ──────────────────────────────────────────── */}
      <div className="card p-5">
        <FinanceEventsTable from={from} to={to} />
      </div>

    </div>
  )
}
