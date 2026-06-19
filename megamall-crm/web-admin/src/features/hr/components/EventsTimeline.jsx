import { useState }    from 'react'
import { useQuery }    from '@tanstack/react-query'
import Badge           from '../../../shared/components/Badge'
import Button          from '../../../shared/components/Button'
import Alert           from '../../../shared/components/Alert'
import EmptyState      from '../../../shared/components/EmptyState'
import { CardSkeleton } from '../../../shared/components/Skeleton'
import { fetchEventsByOrder } from '../api'
import { KEYS }        from '../../../shared/queryKeys'
import {
  fmtMoney, fmtDateTime,
  EVENT_TYPE_LABEL, EVENT_TYPE_BADGE,
  RATE_SOURCE_LABEL,
} from '../utils/hrHelpers'
import { Activity, Search } from 'lucide-react'

/**
 * EventsTimeline — standalone panel shown on tab 'events'.
 * User enters an order ID to look up financial events for that order.
 */
export default function EventsTimeline() {
  const [input,   setInput]   = useState('')
  const [orderId, setOrderId] = useState('')

  const { data: events = [], isLoading, error } = useQuery({
    queryKey: KEYS.hr.events(orderId),
    queryFn:  () => fetchEventsByOrder(orderId),
    enabled:  !!orderId,
    staleTime: 30_000,
  })

  const handleSearch = () => {
    const val = input.trim()
    if (val) setOrderId(val)
  }

  return (
    <div className="space-y-5">
      {/* Search bar */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="input flex-1"
          placeholder="ID заказа…"
        />
        <Button variant="primary" icon={<Search size={15} />} onClick={handleSearch} className="flex-shrink-0">
          Найти
        </Button>
      </div>

      {/* Results */}
      {!orderId && (
        <EmptyState icon={<Activity size={22} />} title="Введите ID заказа для поиска событий" />
      )}

      {orderId && isLoading && (
        <div className="space-y-3">{[1,2,3].map(i => <CardSkeleton key={i} />)}</div>
      )}

      {orderId && error && (
        <Alert variant="error">{error.response?.data?.error?.message ?? error.message}</Alert>
      )}

      {orderId && !isLoading && events.length === 0 && !error && (
        <EmptyState icon={<Activity size={22} />} title="События не найдены" description={`Нет финансовых событий для заказа ${orderId}`} />
      )}

      {events.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400 uppercase tracking-wide">События заказа {orderId} · {events.length}</p>
          {events.map((ev, i) => (
            <div key={ev.id ?? i} className="card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <Badge variant={EVENT_TYPE_BADGE[ev.event_type] ?? 'slate'} size="sm">
                  {EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type}
                </Badge>
                <p className="text-base font-bold text-indigo-700 flex-shrink-0">{fmtMoney(ev.amount)}</p>
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
                {ev.rate != null       && <span>Ставка: <strong>{(ev.rate * 100).toFixed(2)}%</strong></span>}
                {ev.base_amount != null && <span>База: <strong>{fmtMoney(ev.base_amount)}</strong></span>}
                {ev.rate_source        && <span>Источник: <strong>{RATE_SOURCE_LABEL[ev.rate_source] ?? ev.rate_source}</strong></span>}
                {ev.user_id            && <span className="col-span-2 truncate">Пользователь: <strong>{ev.user_id}</strong></span>}
              </div>

              {ev.notes && <p className="text-xs text-slate-500 bg-slate-50 rounded-xl px-3 py-1.5">{ev.notes}</p>}

              <p className="text-[10px] text-slate-300">{fmtDateTime(ev.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
