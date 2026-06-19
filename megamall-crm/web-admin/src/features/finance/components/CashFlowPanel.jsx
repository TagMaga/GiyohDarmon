/**
 * CashFlowPanel — cash handover summary from FinanceCashSummary.
 *
 * Shows:
 *   - Собрано (cash_collected)
 *   - Возвращено (cash_returned)
 *   - На руках (cash_outstanding)
 *   - Передач подтверждено / ожидает
 *
 * Props:
 *   cash     {object}  FinanceCashSummary
 *   loading  {bool}
 */
import { CheckCircle2, Clock, Banknote, ArrowDownLeft, Wallet } from 'lucide-react'
import Badge    from '../../../shared/components/Badge'
import { fmtMoney } from '../../hr/utils/hrHelpers'

export default function CashFlowPanel({ cash, loading = false }) {
  if (loading) {
    return (
      <div className="card p-5 space-y-4">
        <div className="skeleton h-5 w-32 rounded" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-1.5">
              <div className="skeleton h-3 w-16 rounded" />
              <div className="skeleton h-6 w-24 rounded" />
            </div>
          ))}
        </div>
        <div className="skeleton h-px w-full rounded" />
        <div className="flex gap-3">
          <div className="skeleton h-6 w-28 rounded-full" />
          <div className="skeleton h-6 w-28 rounded-full" />
        </div>
      </div>
    )
  }

  const collected   = cash?.cash_collected   ?? 0
  const returned    = cash?.cash_returned    ?? 0
  const outstanding = cash?.cash_outstanding ?? 0
  const confirmed   = cash?.handovers_confirmed ?? 0
  const pending     = cash?.handovers_pending   ?? 0

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Движение кассы</h3>
        <Banknote size={16} className="text-slate-400" />
      </div>

      {/* Three cash metrics */}
      <div className="grid grid-cols-3 gap-3">
        {/* Собрано */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1">
            <Banknote size={11} className="text-emerald-500" />
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Собрано</p>
          </div>
          <p className="text-base font-bold text-slate-900 tabular-nums">{fmtMoney(collected)}</p>
        </div>

        {/* Возвращено */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1">
            <ArrowDownLeft size={11} className="text-sky-500" />
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">Сдано</p>
          </div>
          <p className="text-base font-bold text-slate-900 tabular-nums">{fmtMoney(returned)}</p>
        </div>

        {/* На руках */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1">
            <Wallet size={11} className={outstanding > 0 ? 'text-rose-500' : 'text-slate-400'} />
            <p className="text-[10px] text-slate-400 uppercase tracking-wide">На руках</p>
          </div>
          <p className={`text-base font-bold tabular-nums ${outstanding > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
            {fmtMoney(outstanding)}
          </p>
        </div>
      </div>

      {/* Cash bar visualisation */}
      {collected > 0 && (
        <div className="space-y-1">
          <div className="h-2 rounded-full overflow-hidden bg-slate-100 flex">
            <div
              className="h-full bg-emerald-400 transition-all duration-500"
              style={{ width: `${Math.min((returned / collected) * 100, 100)}%` }}
            />
            <div
              className="h-full bg-rose-400 transition-all duration-500"
              style={{ width: `${Math.min((outstanding / collected) * 100, 100)}%` }}
            />
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Сдано
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> На руках
            </span>
          </div>
        </div>
      )}

      {/* Handover counts */}
      <div className="border-t border-slate-100 pt-3 flex flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 size={13} className="text-emerald-500" />
          <Badge variant="emerald" size="sm">{confirmed} подтверждено</Badge>
        </div>
        {pending > 0 && (
          <div className="flex items-center gap-1.5">
            <Clock size={13} className="text-amber-500" />
            <Badge variant="amber" size="sm">{pending} ожидает</Badge>
          </div>
        )}
      </div>
    </div>
  )
}
