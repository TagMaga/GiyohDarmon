/**
 * CommissionsBreakdown — per-type employee payout bars.
 *
 * Shows actual ledger event details. This is separate from the Owner gross team
 * pool KPI, which is calculated from the approved owner finance model.
 *   seller_commission_earned
 *   manager_personal_commission_earned
 *   manager_team_commission_earned
 *   team_lead_pool_earned
 *
 * Props:
 *   revenue  {object}  FinanceRevenueSummary
 *   loading  {bool}
 */
import Badge    from '../../../shared/components/Badge'
import { fmtMoney } from '../../hr/utils/hrHelpers'

const fmtPct = (v) => {
  const r = Math.round(v)
  return Math.abs(v - r) < 0.05 ? `${r}` : v.toFixed(1)
}

const ROWS = [
  {
    key:    'seller_commission_earned',
    label:  'Продавцы',
    badge:  'indigo',
    bar:    'bg-indigo-400',
  },
  {
    key:    'manager_personal_commission_earned',
    label:  'Менеджеры (личные)',
    badge:  'sky',
    bar:    'bg-sky-400',
  },
  {
    key:    'manager_team_commission_earned',
    label:  'Менеджеры (команда)',
    badge:  'violet',
    bar:    'bg-violet-400',
  },
  {
    key:    'team_lead_pool_earned',
    label:  'Пул руководителей',
    badge:  'amber',
    bar:    'bg-amber-400',
  },
]

export default function CommissionsBreakdown({ revenue, loading = false }) {
  if (loading) {
    return (
      <div className="card p-5 space-y-4">
        <div className="skeleton h-5 w-36 rounded" />
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="animate-pulse space-y-1.5">
            <div className="flex justify-between">
              <div className="skeleton h-4 w-32 rounded" />
              <div className="skeleton h-4 w-16 rounded" />
            </div>
            <div className="skeleton h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  const total = revenue?.total_employee_payouts ?? 0

  const rows = ROWS.map(r => ({
    ...r,
    amount: revenue?.[r.key] ?? 0,
    pct:    total > 0 ? Math.min(((revenue?.[r.key] ?? 0) / total) * 100, 100) : 0,
  })).filter(r => r.amount > 0 || total === 0)

  const hasData = rows.some(r => r.amount > 0)

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Фактические начисления по событиям</h3>
        <span className="text-sm font-bold text-slate-900 tabular-nums">{fmtMoney(total)}</span>
      </div>

      {!hasData ? (
        <p className="text-sm text-slate-400 text-center py-3">
          Нет начислений за период
        </p>
      ) : (
        <div className="space-y-4">
          {rows.map(r => (
            <div key={r.key}>
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <Badge variant={r.badge} size="sm">{r.label}</Badge>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[11px] text-slate-400">{fmtPct(r.pct)}%</span>
                  <span className="text-sm font-bold text-slate-900 tabular-nums">{fmtMoney(r.amount)}</span>
                </div>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${r.bar}`}
                  style={{ width: `${r.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
