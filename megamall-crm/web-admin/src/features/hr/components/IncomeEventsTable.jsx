/**
 * IncomeEventsTable — paginated list of income events from IncomeReportResponse.events.
 * Rendered only when include_events=true was passed to the income endpoint.
 *
 * Props:
 *   events   {Array}  IncomeEventResponse[]
 *   loading  {bool}
 */
import Badge     from '../../../shared/components/Badge'
import EmptyState from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { fmtMoney, fmtDateTime, EVENT_TYPE_LABEL, EVENT_TYPE_BADGE } from '../utils/hrHelpers'
import { Wallet } from 'lucide-react'

const ORDER_TYPE_LABEL = {
  seller_order:             'Заказ продавца',
  manager_personal_order:   'Личный (менеджер)',
  team_lead_personal_order: 'Личный (тимлид)',
}

export default function IncomeEventsTable({ events = [], loading = false }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => <CardSkeleton key={i} />)}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Wallet size={22} />}
        title="Нет начислений"
        description="За выбранный период начисления не найдены"
      />
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400 uppercase tracking-wide">
        Начисления · {events.length}
      </p>

      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
              <th className="py-2.5 pr-3 text-left font-semibold">Заказ</th>
              <th className="py-2.5 pr-3 text-left font-semibold">Тип</th>
              <th className="py-2.5 pr-3 text-left font-semibold">Событие</th>
              <th className="py-2.5 pr-3 text-right font-semibold">Сумма</th>
              <th className="py-2.5 text-right font-semibold">Дата</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={ev.id ?? i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td className="py-2.5 pr-3">
                  <p className="font-mono text-xs text-slate-700">{ev.order_number || '—'}</p>
                  {ev.order_type && (
                    <p className="text-[10px] text-slate-400">{ORDER_TYPE_LABEL[ev.order_type] ?? ev.order_type}</p>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <Badge variant={EVENT_TYPE_BADGE[ev.event_type] ?? 'slate'} size="sm">
                    {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                  </Badge>
                </td>
                <td className="py-2.5 pr-3">
                  {ev.net_revenue != null && (
                    <span className="text-xs text-slate-400">Выручка: {fmtMoney(ev.net_revenue)}</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right">
                  <span className="font-bold text-indigo-700 tabular-nums">{fmtMoney(ev.amount)}</span>
                </td>
                <td className="py-2.5 text-right text-xs text-slate-400 whitespace-nowrap">
                  {fmtDateTime(ev.created_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="sm:hidden space-y-2">
        {events.map((ev, i) => (
          <div key={ev.id ?? i} className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-mono text-xs text-slate-700">{ev.order_number || '—'}</p>
                {ev.order_type && (
                  <p className="text-[10px] text-slate-400 mt-0.5">{ORDER_TYPE_LABEL[ev.order_type] ?? ev.order_type}</p>
                )}
              </div>
              <span className="font-bold text-indigo-700 tabular-nums text-base flex-shrink-0">
                {fmtMoney(ev.amount)}
              </span>
            </div>
            <Badge variant={EVENT_TYPE_BADGE[ev.event_type] ?? 'slate'} size="sm">
              {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
            </Badge>
            <div className="flex items-center justify-between text-xs text-slate-400">
              {ev.net_revenue != null && <span>Выручка: {fmtMoney(ev.net_revenue)}</span>}
              <span className="ml-auto">{fmtDateTime(ev.created_at)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
