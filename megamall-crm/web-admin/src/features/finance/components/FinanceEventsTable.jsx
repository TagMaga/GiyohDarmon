/**
 * FinanceEventsTable — paginated financial event ledger for the owner.
 *
 * Uses GET /finance/events (all event types including company_revenue_earned).
 *
 * Features:
 *   - event_type dropdown filter
 *   - pagination (prev/next + page indicator)
 *   - desktop table + mobile card stack
 *
 * Props:
 *   from     {string}  YYYY-MM-DD
 *   to       {string}  YYYY-MM-DD
 */
import { useState }       from 'react'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react'
import Badge              from '../../../shared/components/Badge'
import EmptyState         from '../../../shared/components/EmptyState'
import { CardSkeleton }   from '../../../shared/components/Skeleton'
import useFinanceEvents   from '../hooks/useFinanceEvents'
import {
  fmtMoney,
  fmtDateTime,
  EVENT_TYPE_LABEL,
  EVENT_TYPE_BADGE,
} from '../../hr/utils/hrHelpers'

// Finance-specific event type options for the filter dropdown
const EVENT_TYPE_OPTIONS = [
  { value: '',                                    label: 'Все типы' },
  { value: 'company_revenue_earned',              label: 'Доход компании' },
  { value: 'seller_commission_earned',            label: 'Комиссия продавца' },
  { value: 'manager_personal_commission_earned',  label: 'Комиссия менеджера (личная)' },
  { value: 'manager_team_commission_earned',      label: 'Комиссия менеджера (команда)' },
  { value: 'team_lead_pool_earned',               label: 'Пул руководителя' },
]

const PAGE_LIMIT = 20

export default function FinanceEventsTable({ from, to }) {
  const [eventType, setEventType] = useState('')
  const [page,      setPage]      = useState(1)

  // Reset to page 1 when type filter changes
  function handleTypeChange(e) {
    setEventType(e.target.value)
    setPage(1)
  }

  const params = { from, to, event_type: eventType || undefined, page, limit: PAGE_LIMIT }
  const { data, isLoading, isFetching } = useFinanceEvents(params)

  const items     = data?.items  ?? []
  const meta      = data?.meta   ?? null
  const totalPages = meta?.total_pages ?? 1
  const total      = meta?.total       ?? 0
  const isMuted    = isFetching && !isLoading  // page transition, show old data dimmed

  return (
    <div className="space-y-4">
      {/* Header row: title + filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">
            Журнал начислений
            {total > 0 && (
              <span className="ml-2 text-xs font-normal text-slate-400">· {total} событий</span>
            )}
          </h3>
        </div>
        <select
          value={eventType}
          onChange={handleTypeChange}
          className="input h-9 text-xs py-0 pr-8 w-auto min-w-[160px]"
        >
          {EVENT_TYPE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} />}
          title="Нет событий"
          description="За выбранный период и фильтр событий нет"
        />
      ) : (
        <div className={isMuted ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="py-2.5 pr-3 text-left font-semibold">Тип события</th>
                  <th className="py-2.5 pr-3 text-left font-semibold">Заказ / Польз.</th>
                  <th className="py-2.5 pr-3 text-right font-semibold">Сумма</th>
                  <th className="py-2.5 text-right font-semibold">Дата</th>
                </tr>
              </thead>
              <tbody>
                {items.map((ev, i) => (
                  <tr
                    key={ev.id ?? i}
                    className="border-b border-slate-50 hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-2.5 pr-3">
                      <Badge variant={EVENT_TYPE_BADGE[ev.event_type] ?? 'slate'} size="sm">
                        {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3">
                      {ev.order_id
                        ? <p className="font-mono text-xs text-slate-600">{ev.order_id.slice(0, 8)}…</p>
                        : <p className="text-xs text-slate-400">—</p>
                      }
                      {ev.user_id && (
                        <p className="text-[10px] text-slate-400">{ev.user_id.slice(0, 8)}…</p>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className="font-bold text-slate-900 tabular-nums">{fmtMoney(ev.amount)}</span>
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
            {items.map((ev, i) => (
              <div key={ev.id ?? i} className="card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <Badge variant={EVENT_TYPE_BADGE[ev.event_type] ?? 'slate'} size="sm">
                    {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                  </Badge>
                  <span className="font-bold text-slate-900 tabular-nums flex-shrink-0">
                    {fmtMoney(ev.amount)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-mono">
                    {ev.order_id ? ev.order_id.slice(0, 8) + '…' : '—'}
                  </span>
                  <span>{fmtDateTime(ev.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1 || isFetching}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[44px]"
          >
            <ChevronLeft size={14} /> Назад
          </button>

          <span className="text-xs text-slate-500">
            Стр. {page} из {totalPages}
          </span>

          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || isFetching}
            className="flex items-center gap-1 px-3 py-2 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[44px]"
          >
            Вперёд <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
