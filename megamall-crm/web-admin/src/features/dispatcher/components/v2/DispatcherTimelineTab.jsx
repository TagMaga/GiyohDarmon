import { useQuery } from '@tanstack/react-query'
import { Loader2, Package, Check, CreditCard, Truck, AlertTriangle, X, MessageSquare, RotateCcw, Clock } from 'lucide-react'
import Skeleton from '../../../../shared/components/Skeleton'
import { KEYS } from '../../../../shared/queryKeys'
import { fetchOrderTimeline } from '../../api'
import { STATUS_HEX, fmtDate } from '../../statusConfig'

const EVENT_LABELS = {
  new:                  { label: 'Заказ создан',          color: '#64748b', Icon: Package      },
  confirmed:            { label: 'Подтверждён',           color: STATUS_HEX.confirmed  ?? '#0ea5e9', Icon: Check },
  prepayment_pending:   { label: 'Ожидает предоплату',    color: '#f59e0b', Icon: CreditCard   },
  prepayment_received:  { label: 'Предоплата получена',   color: '#10b981', Icon: CreditCard   },
  assigned:             { label: 'Курьер назначен',       color: STATUS_HEX.assigned   ?? '#8b5cf6', Icon: Truck },
  in_delivery:          { label: 'В доставке',            color: STATUS_HEX.in_delivery ?? '#f59e0b', Icon: Truck },
  delivered:            { label: 'Доставлен',             color: STATUS_HEX.delivered  ?? '#10b981', Icon: Check },
  returned:             { label: 'Возврат',               color: STATUS_HEX.returned   ?? '#f97316', Icon: RotateCcw },
  issue:                { label: 'Проблема',              color: STATUS_HEX.issue      ?? '#ef4444', Icon: AlertTriangle },
  cancelled:            { label: 'Отменён',               color: STATUS_HEX.cancelled  ?? '#64748b', Icon: X },
  scheduled:            { label: 'Запланировано',         color: '#f59e0b', Icon: Clock },
  comment:              { label: 'Комментарий',           color: '#6366f1', Icon: MessageSquare },
}

export default function DispatcherTimelineTab({ orderId }) {
  const { data: timeline = [], isLoading } = useQuery({
    queryKey: KEYS.dispatcher.timeline(orderId),
    queryFn:  () => fetchOrderTimeline(orderId),
    enabled:  !!orderId,
    staleTime: 30_000,
  })

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    )
  }

  if (!Array.isArray(timeline) || timeline.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center py-10">
          <Loader2 size={24} className="mx-auto text-slate-200 mb-2" />
          <p className="text-sm text-slate-400">История пуста</p>
        </div>
      </div>
    )
  }

  // Show newest first
  const events = [...timeline].reverse()

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="relative">
        {/* Vertical connector line */}
        <div
          className="absolute left-3.5 top-4 bottom-4 w-px bg-slate-100"
          aria-hidden="true"
        />

        <div className="space-y-4">
          {events.map((event, i) => {
            const type    = event.event_type ?? event.status ?? 'comment'
            const meta    = EVENT_LABELS[type] ?? EVENT_LABELS.comment
            const isFirst = i === 0

            return (
              <div key={event.id ?? i} className="flex gap-3 relative">
                {/* Dot / Icon */}
                <div
                  className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ring-4 ring-white z-10 ${isFirst ? 'shadow-sm' : ''}`}
                  style={{ background: `${meta.color}18`, border: `1.5px solid ${meta.color}40` }}
                >
                  {meta.Icon
                    ? <meta.Icon size={12} strokeWidth={2.5} style={{ color: meta.color }} />
                    : <div className="w-2.5 h-2.5 rounded-full" style={{ background: meta.color }} />
                  }
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-baseline justify-between gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">{meta.label}</span>
                    <span className="text-[10px] text-slate-400 flex-shrink-0">
                      {fmtDate(event.created_at)}
                    </span>
                  </div>

                  {event.actor_name && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs text-slate-500">{event.actor_name}</span>
                      {event.actor_role && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                          {event.actor_role}
                        </span>
                      )}
                    </div>
                  )}

                  {event.comment && (
                    <p className="text-xs text-slate-600 mt-1 bg-slate-50 rounded-lg px-3 py-1.5 leading-relaxed">
                      {event.comment}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
