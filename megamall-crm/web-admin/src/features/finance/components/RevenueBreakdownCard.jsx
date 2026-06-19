/**
 * RevenueBreakdownCard — splits net_revenue into company vs employee payouts.
 *
 * Shows:
 *   - Total net revenue (100%)
 *   - Company share  (company_revenue_earned / net_revenue)
 *   - Employee share (total_employee_payouts / net_revenue)
 *   - Visual stacked bar
 *
 * Props:
 *   revenue  {object}  FinanceRevenueSummary
 *   orders   {object}  FinanceOrdersSummary
 *   loading  {bool}
 */
import { Building2, Users2 } from 'lucide-react'
import { fmtMoney }          from '../../hr/utils/hrHelpers'

function pct(part, total) {
  if (!total) return 0
  return Math.min((part / total) * 100, 100)
}

function PctBar({ companyPct, employeePct }) {
  const rest = Math.max(0, 100 - companyPct - employeePct)
  return (
    <div className="h-3 rounded-full overflow-hidden bg-slate-100 flex">
      <div
        className="h-full bg-violet-500 transition-all duration-500"
        style={{ width: `${companyPct}%` }}
        title={`Компания ${companyPct.toFixed(1)}%`}
      />
      <div
        className="h-full bg-amber-400 transition-all duration-500"
        style={{ width: `${employeePct}%` }}
        title={`Сотрудники ${employeePct.toFixed(1)}%`}
      />
      {rest > 0.5 && (
        <div
          className="h-full bg-slate-200 transition-all duration-500"
          style={{ width: `${rest}%` }}
        />
      )}
    </div>
  )
}

export default function RevenueBreakdownCard({ revenue, orders, loading = false }) {
  if (loading) {
    return (
      <div className="card p-5 space-y-4">
        <div className="skeleton h-5 w-40 rounded" />
        <div className="skeleton h-3 w-full rounded-full" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex justify-between">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-4 w-20 rounded" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const netRevenue    = orders?.net_revenue             ?? 0
  const company       = revenue?.company_revenue_earned  ?? 0
  const employees     = revenue?.total_employee_payouts  ?? 0
  const companyPct    = pct(company,   netRevenue)
  const employeePct   = pct(employees, netRevenue)

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Распределение выручки</h3>
        <span className="text-xs text-slate-400">от чистой выручки</span>
      </div>

      {/* Total net revenue */}
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{fmtMoney(netRevenue)}</span>
        <span className="text-xs text-slate-400">чистая выручка</span>
      </div>

      {/* Stacked bar */}
      <PctBar companyPct={companyPct} employeePct={employeePct} />

      {/* Legend */}
      <div className="space-y-2.5">
        {/* Company */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-violet-500 flex-shrink-0" />
            <div className="flex items-center gap-1.5">
              <Building2 size={12} className="text-slate-400" />
              <span className="text-xs text-slate-600 font-medium">Доход компании</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">{companyPct.toFixed(1)}%</span>
            <span className="text-sm font-bold text-slate-900 tabular-nums">{fmtMoney(company)}</span>
          </div>
        </div>

        {/* Employees */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
            <div className="flex items-center gap-1.5">
              <Users2 size={12} className="text-slate-400" />
              <span className="text-xs text-slate-600 font-medium">Выплаты сотрудникам</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-400">{employeePct.toFixed(1)}%</span>
            <span className="text-sm font-bold text-slate-900 tabular-nums">{fmtMoney(employees)}</span>
          </div>
        </div>

        {/* Delivery fees (from orders, shown for context) */}
        <div className="border-t border-slate-100 pt-2.5 flex items-center justify-between">
          <span className="text-xs text-slate-500">Сборы за доставку</span>
          <span className="text-sm font-semibold text-slate-700 tabular-nums">
            {fmtMoney(orders?.delivery_fees ?? 0)}
          </span>
        </div>
      </div>
    </div>
  )
}
